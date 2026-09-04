import type { SceneGraph } from '@open-pencil/scene-graph'
import { registerImagesRequest, requestMissingImages } from '@open-pencil/core/io/formats/fig'

import { apiGet, apiGetBytes, apiJson, apiPutBytes } from './client'

/**
 * Images live outside the documents that reference them.
 *
 * A .fig is overwhelmingly images: the 163MB file that prompted this was
 * 155MB of images wrapped around 138KB of actual design. Keeping them in
 * the saved archive meant every autosave rebuilt and moved the entire
 * 163MB — onto the main thread, again into the compression worker, into
 * IndexedDB, back out, and into the request body. Splitting them out
 * makes a save the design alone, and makes an image something that
 * uploads once and is then shared by every later revision.
 */

// The team an open document belongs to, which is what its assets are
// addressed under. Cached because it's needed on every save and never
// changes for a given document (moving a document between projects stays
// within one team — see the guard on PATCH /documents/:id).
const documentTeams = new Map<string, string>()

export async function teamIdForDocument(documentId: string): Promise<string> {
  const cached = documentTeams.get(documentId)
  if (cached) return cached
  const { document } = await apiGet<{ document: { team_id: string } }>(
    `/documents/${documentId}`
  )
  if (!document?.team_id) throw new Error(`No team for document ${documentId}`)
  documentTeams.set(documentId, document.team_id)
  return document.team_id
}

export function forgetDocumentTeam(documentId: string): void {
  documentTeams.delete(documentId)
}

async function missingAssetHashes(teamId: string, hashes: string[]): Promise<string[]> {
  if (hashes.length === 0) return []
  const { missing } = await apiJson<{ missing: string[] }>(
    'POST',
    `/teams/${teamId}/assets/missing`,
    { hashes }
  )
  return missing
}

/**
 * Uploads whichever of `hashes` the server doesn't already hold.
 *
 * Deliberately one image at a time. The bytes for a document this
 * mechanism exists to serve total ~155MB and individual images reach
 * 12MB+; fetching them from the session worker as a batch would
 * reproduce, on the upload path, exactly the simultaneous allocation
 * that was crashing the renderer. Peak cost here is one image.
 */
export async function uploadDocumentAssets(
  graph: SceneGraph,
  teamId: string,
  hashes: string[],
  onProgress?: (uploaded: number, total: number) => void
): Promise<void> {
  const missing = await missingAssetHashes(teamId, hashes)
  if (missing.length === 0) return

  for (let index = 0; index < missing.length; index++) {
    const hash = missing[index]
    let bytes = graph.images.get(hash)
    if (!bytes) {
      // Not resident on the main thread — for a lazily-opened document
      // most images never are. The session worker still holds the
      // original archive and can extract just this one.
      const fetched = await requestMissingImages(graph, [hash])
      bytes = fetched.find(([h]) => h === hash)?.[1]
    }
    if (!bytes) {
      // An image the graph references but nothing can produce. Skipping
      // beats failing the whole save: the document still opens, that one
      // fill just renders empty.
      console.warn(`[assets] no bytes available for image ${hash}, skipping`)
      continue
    }
    const res = await apiPutBytes(`/teams/${teamId}/assets/${hash}`, bytes)
    if (!res.ok) throw new Error(`Failed to upload image ${hash}: ${res.status}`)
    onProgress?.(index + 1, missing.length)
  }
}

/**
 * Points a graph's image lookups at the team's asset store. Documents
 * saved with images split out carry none in their archive, so this is
 * what makes them render at all — the editor's existing per-page
 * ensureImagesLoaded path calls straight into it, so images arrive as
 * pages are visited rather than all at once on open.
 */
export function registerHostedImageSource(graph: SceneGraph, teamId: string): void {
  registerImagesRequest(graph, async (hashes) => {
    const loaded: Array<[string, Uint8Array]> = []
    for (const hash of hashes) {
      const bytes = await apiGetBytes(`/teams/${teamId}/assets/${hash}`).catch(() => null)
      if (bytes) loaded.push([hash, bytes])
    }
    return loaded
  })
}
