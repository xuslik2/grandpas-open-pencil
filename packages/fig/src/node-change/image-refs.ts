import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'

import { imageHashToString } from './paint'

function collectPaintImageHashes(paints: Paint[] | undefined, into: Set<string>): void {
  if (!paints) return
  for (const paint of paints) {
    if (paint.type !== 'IMAGE' || !paint.image) continue
    const hash = paint.image.hash
    if (typeof hash === 'string') into.add(hash)
    else if (hash && typeof hash === 'object') {
      into.add(imageHashToString(hash as unknown as Record<string, number>))
    }
  }
}

/**
 * Image hashes referenced by nodes on the pages an initial "first page"
 * import will actually populate — the first page, plus every page that
 * contains a COMPONENT/COMPONENT_SET definition — computed straight over
 * a .fig file's raw, kiwi-decoded NodeChange[], before any SceneGraph
 * exists.
 *
 * This lets archive.ts decide which images are worth decompressing from
 * the zip at all, instead of inflating every image in the file
 * regardless of page. It has to be conservative about component pages:
 * an instance on the first page can pull in a component defined on any
 * other page, and once that page's instance-population expands the
 * component's cloned children, their images need to already exist —
 * there's no worker left holding the un-decompressed bytes to fall back
 * to fetching them from at that point, unlike page-switch images (see
 * ensureImagesLoaded in packages/core), which the worker can still
 * serve on demand. Including every component page's images uses more
 * memory than tracking exactly which components the first page actually
 * instantiates would, but avoids that unrecoverable gap; still far less
 * than every image in the whole file for a page-heavy document.
 *
 * "First page" is a cheap guess (raw array order, not the
 * position-sorted order the real importer later uses) — a wrong guess
 * there just means the actually-displayed page's images get fetched on
 * demand instead of being ready immediately, not a correctness problem.
 * Returns null if no CANVAS node change is found at all, so the caller
 * can fall back to decompressing everything rather than mistakenly
 * treating "couldn't identify a page" as "needs no images".
 */
export function firstPageImageHashes(nodeChanges: NodeChange[]): Set<string> | null {
  const parentGuid = new Map<string, string>()
  const nodeType = new Map<string, string>()
  for (const nc of nodeChanges) {
    if (!nc.guid || nc.phase === 'REMOVED') continue
    const id = guidToString(nc.guid)
    if (nc.type) nodeType.set(id, nc.type)
    if (nc.parentIndex?.guid) parentGuid.set(id, guidToString(nc.parentIndex.guid))
  }

  // Walks up to the nearest CANVAS ancestor (a page), not just to
  // wherever the parent chain runs out — the document root isn't a page.
  function pageIdFor(id: string): string | null {
    const seen = new Set<string>()
    let current: string | undefined = id
    while (current) {
      if (nodeType.get(current) === 'CANVAS') return current
      if (seen.has(current)) return null
      seen.add(current)
      current = parentGuid.get(current)
    }
    return null
  }

  let firstPageId: string | null = null
  const includedPageIds = new Set<string>()
  for (const nc of nodeChanges) {
    if (!nc.guid || nc.phase === 'REMOVED') continue
    if (nc.type === 'CANVAS' && firstPageId === null) {
      firstPageId = guidToString(nc.guid)
      includedPageIds.add(firstPageId)
    }
    if (nc.type === 'COMPONENT' || nc.type === 'COMPONENT_SET') {
      const parentPageId = nc.parentIndex?.guid ? pageIdFor(guidToString(nc.parentIndex.guid)) : null
      if (parentPageId) includedPageIds.add(parentPageId)
    }
  }
  if (!firstPageId) return null

  function isOnIncludedPage(id: string): boolean {
    const pageId = pageIdFor(id)
    return pageId !== null && includedPageIds.has(pageId)
  }

  const hashes = new Set<string>()
  for (const nc of nodeChanges) {
    if (!nc.guid || nc.phase === 'REMOVED') continue
    if (!isOnIncludedPage(guidToString(nc.guid))) continue
    collectPaintImageHashes(nc.fillPaints, hashes)
    collectPaintImageHashes(nc.strokePaints, hashes)
  }
  return hashes
}
