import type { SceneGraph } from '@open-pencil/scene-graph'

function pageIdForNode(
  graph: SceneGraph,
  nodeId: string,
  cache: Map<string, string | null>
): string | null {
  const cached = cache.get(nodeId)
  if (cached !== undefined) return cached

  const node = graph.getNode(nodeId)
  if (!node) return null
  if (node.type === 'CANVAS') {
    cache.set(nodeId, nodeId)
    return nodeId
  }
  if (!node.parentId) {
    cache.set(nodeId, null)
    return null
  }
  const pageId = pageIdForNode(graph, node.parentId, cache)
  cache.set(nodeId, pageId)
  return pageId
}

/**
 * Image hashes referenced by fills across the graph. When `pageIds` is
 * given, only nodes belonging to those pages are considered — used to
 * scope an image fetch to just the page(s) actually being shown, instead
 * of every image in the file. Base node shells (with fills already
 * resolved) exist for every page as soon as a .fig import completes,
 * regardless of lazy instance-population state, so this is accurate for
 * any page immediately — it doesn't need to wait for that page's
 * instances to be expanded first.
 */
export function collectImageHashes(graph: SceneGraph, pageIds?: ReadonlySet<string>): Set<string> {
  const hashes = new Set<string>()
  const cache = new Map<string, string | null>()
  for (const node of graph.getAllNodes()) {
    if (pageIds) {
      const pageId = pageIdForNode(graph, node.id, cache)
      if (!pageId || !pageIds.has(pageId)) continue
    }
    for (const fill of node.fills ?? []) {
      if (fill.imageHash) hashes.add(fill.imageHash)
    }
  }
  return hashes
}
