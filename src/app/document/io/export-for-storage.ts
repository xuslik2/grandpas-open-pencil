import type { CanvasKit } from 'canvaskit-wasm'

import type { SkiaRenderer } from '@open-pencil/core/canvas'
import { exportFigDocument } from '@open-pencil/core/io/formats/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { teamIdForDocument, uploadDocumentAssets } from '@/app/integrations/storage/hosted/assets'
import { HostedApiError } from '@/app/integrations/storage/hosted/client'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

/**
 * The one storage backend that holds images separately from the
 * documents referencing them. Everything else (local disk, S3, a plain
 * download) still gets a complete, self-contained .fig.
 */
const ASSET_STORAGE_PROVIDER = 'hosted-server'

export function storesImagesSeparately(binding: StorageDocumentBinding | null): boolean {
  return binding?.providerId === ASSET_STORAGE_PROVIDER
}

type ExportForStorageOptions = {
  graph: SceneGraph
  binding: StorageDocumentBinding | null
  ck?: CanvasKit
  renderer?: SkiaRenderer
  pageId?: string
  /**
   * Skip pushing images to the server. Used for local recovery
   * snapshots, which want the same small archive but must never do
   * network I/O — they exist for the case where the network is what
   * failed.
   */
  skipAssetUpload?: boolean
}

/**
 * Builds the bytes to persist for a document.
 *
 * For asset-backed storage this is the design alone — roughly 140KB for
 * a file whose complete archive is 163MB — with the images uploaded
 * separately and only when the server doesn't already have them. That
 * gap is the whole point: the old path rebuilt and moved all 163MB on
 * every single autosave, which is what was killing the renderer.
 */
export async function exportDocumentForStorage({
  graph,
  binding,
  ck,
  renderer,
  pageId,
  skipAssetUpload = false
}: ExportForStorageOptions): Promise<Uint8Array> {
  const separateImages = storesImagesSeparately(binding)

  const { bytes, imageHashes } = await exportFigDocument(graph, {
    ck,
    renderer,
    pageId,
    excludeImages: separateImages
  })

  if (separateImages && binding && !skipAssetUpload) {
    try {
      // Before the document that references them, deliberately. A saved
      // document pointing at images the server doesn't hold yet would
      // render with holes for anyone who opened it in between.
      const teamId = await teamIdForDocument(binding.documentId)
      await uploadDocumentAssets(graph, teamId, imageHashes)
    } catch (error) {
      if (!isAssetStorageUnavailable(error)) throw error
      // Talking to a server that predates asset storage. Fall back to a
      // complete, self-contained archive: more expensive to build, but a
      // save that works beats a save that's cheap, and it keeps this
      // deployable independently of the server it talks to.
      console.warn('[assets] asset storage unavailable; saving a full archive instead:', error)
      const complete = await exportFigDocument(graph, {
        ck,
        renderer,
        pageId,
        excludeImages: false
      })
      return complete.bytes
    }
  }

  return bytes
}

function isAssetStorageUnavailable(error: unknown): boolean {
  return error instanceof HostedApiError && (error.status === 404 || error.status === 405)
}
