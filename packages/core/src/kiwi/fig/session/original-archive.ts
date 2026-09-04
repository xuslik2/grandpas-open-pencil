import type { SceneGraph } from '@open-pencil/scene-graph'

import { requestOriginalArchive } from '#core/kiwi/fig/population/client'

const originalFigArchives = new WeakMap<SceneGraph, () => Promise<Uint8Array>>()

export function registerOriginalFigArchive(
  graph: SceneGraph,
  requestArchive: () => Promise<Uint8Array>
): void {
  originalFigArchives.set(graph, requestArchive)
}

/**
 * The unmodified bytes of the .fig this graph was imported from, or null
 * if it was edited since (or never came from one).
 *
 * Ownership contract: providers must return a freshly allocated buffer
 * that the caller owns outright — never a retained one. Callers are
 * therefore free to hand it straight on without a defensive copy, which
 * for a large document is the difference between one full-file
 * allocation and two.
 */
export async function originalFigArchive(graph: SceneGraph): Promise<Uint8Array | null> {
  return (await originalFigArchives.get(graph)?.()) ?? (await requestOriginalArchive(graph))
}

export function releaseOriginalFigArchive(graph: SceneGraph): void {
  originalFigArchives.delete(graph)
}
