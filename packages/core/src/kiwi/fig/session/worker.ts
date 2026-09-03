import { parseFigBuffer } from '@open-pencil/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { collectImageHashes } from '#core/kiwi/fig/image-refs'
import { importNodeChanges } from '#core/kiwi/fig/import'
import { getLazyFigImportContext, populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import { serializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import { buildFigPopulationDelta, installFigMutationJournal } from '#core/kiwi/fig/population/delta'
import type {
  FigSessionOpenRequest,
  FigSessionRequest,
  FigSessionResponse
} from '#core/kiwi/fig/session/protocol'

let graph: SceneGraph | undefined
let originalArchive: Uint8Array | undefined
let port: MessagePort | undefined
// Which image hashes the main thread already has — the initial 'graph'
// response only includes images for the pages populated up front (see
// below), so later 'images' requests (page switch, export) only need to
// ship whatever hasn't crossed the port yet.
let sentImageHashes = new Set<string>()

function respond(message: FigSessionResponse): void {
  port?.postMessage(message)
}

function populate(request: Extract<FigSessionRequest, { type: 'populate' }>): void {
  if (!graph) throw new Error('FIG session has no retained graph')
  const journal = installFigMutationJournal(graph)
  try {
    const populated = populateLazyFigImportRoots(graph, [request.pageId])
    const context = getLazyFigImportContext(graph)
    if (!context) throw new Error('FIG session has no lazy import context')
    respond({
      type: 'population-result',
      requestId: request.requestId,
      baseRevision: request.baseRevision,
      populated,
      delta: buildFigPopulationDelta(graph, journal, context.populatedRootIds)
    })
  } finally {
    journal.stop()
  }
}

function handleRequest(request: FigSessionRequest): void {
  try {
    if (request.type === 'original-archive') {
      if (!originalArchive) throw new Error('FIG session has no original archive')
      const bytes = originalArchive.slice()
      port?.postMessage({ type: 'original-archive-result', requestId: request.requestId, bytes }, [
        bytes.buffer
      ])
      return
    }
    if (request.type === 'images') {
      const images: Array<[string, Uint8Array]> = []
      const transfer: Transferable[] = []
      for (const hash of request.hashes) {
        if (sentImageHashes.has(hash)) continue
        const data = graph?.images.get(hash)
        if (!data) continue
        // Copy, not the retained bytes themselves — transferring those
        // would neuter graph.images here, breaking any later population
        // or export that still needs them from this same worker.
        const copy = data.slice()
        images.push([hash, copy])
        transfer.push(copy.buffer)
        sentImageHashes.add(hash)
      }
      port?.postMessage({ type: 'images-result', requestId: request.requestId, images }, transfer)
      return
    }
    if (request.type === 'dispose') {
      graph = undefined
      originalArchive = undefined
      sentImageHashes = new Set()
      respond({ type: 'disposed' })
      port?.close()
      port = undefined
      self.close()
      return
    }
    if (request.type === 'cancel') return
    populate(request)
  } catch (error) {
    respond({
      type: 'population-error',
      requestId: request.type === 'populate' ? request.requestId : undefined,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

self.onmessage = (event: MessageEvent<FigSessionOpenRequest>) => {
  const request = event.data
  port = request.port
  port.onmessage = (message: MessageEvent<FigSessionRequest>) => handleRequest(message.data)
  port.start()
  // A view over the transferred buffer, not a copy — parseFigBuffer below
  // only reads from it, so it's safe for both to reference the same bytes.
  originalArchive = new Uint8Array(request.buffer)
  try {
    const { nodeChanges, blobs, images, figKiwiVersion, figSchemaDeflated } = parseFigBuffer(
      request.buffer,
      (pages) => respond({ type: 'page-manifest', pages })
    )
    const parsedGraph = importNodeChanges(nodeChanges, blobs, new Map(images), request.options)
    parsedGraph.figKiwiVersion = figKiwiVersion
    parsedGraph.figSchemaDeflated = figSchemaDeflated
    graph = request.options?.populate === 'first-page' ? parsedGraph : undefined

    const serialized = serializeSceneGraph(parsedGraph)
    // For a lazily-populated open, only ship images the initially
    // populated pages (first page + any component pages they depend on)
    // actually reference — not every image in the file. graph.images
    // itself keeps everything (still needed here for later 'images'
    // requests as more pages get visited); this only trims what
    // structured-clones across the port on this first response.
    if (graph) {
      const activeRootIds = getLazyFigImportContext(graph)?.populatedRootIds
      if (activeRootIds) {
        const initialHashes = collectImageHashes(graph, activeRootIds)
        serialized.images = serialized.images.filter(([hash]) => initialHashes.has(hash))
      }
    }
    for (const [hash] of serialized.images) sentImageHashes.add(hash)
    respond({ type: 'graph', graph: serialized })
  } catch (error) {
    respond({ type: 'graph', error: error instanceof Error ? error.message : String(error) })
  }
}
