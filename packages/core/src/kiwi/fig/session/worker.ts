import { extractFigImages, parseFigBuffer } from '@open-pencil/fig'
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
      // Every requested hash is served: the main thread only ever asks
      // for images it doesn't already have (see ensureImagesLoaded), so
      // there's nothing to skip. Requests arrive in small batches, which
      // is what keeps this bounded — decompressing and shipping a whole
      // media-heavy page's images at once is a big enough sudden
      // allocation to take the renderer down.
      const images: Array<[string, Uint8Array]> = []
      const transfer: Transferable[] = []
      const missing: string[] = []
      for (const hash of request.hashes) {
        const data = graph?.images.get(hash)
        if (!data) {
          missing.push(hash)
          continue
        }
        // Copy, not the retained bytes themselves — transferring those
        // would neuter graph.images here, breaking any later population
        // or export that still needs them from this same worker.
        const copy = data.slice()
        images.push([hash, copy])
        transfer.push(copy.buffer)
      }
      // parseFigBuffer's limitToFirstPage means graph.images may not
      // have every hash — the rest were never decompressed from the zip,
      // not just never sent. Decompress those specific entries now from
      // the still-retained (compressed) original archive bytes. These are
      // transferred rather than also cached: a second copy here doubles
      // the spike for exactly the documents this path exists to make
      // survivable, and anything asked for again can be re-extracted.
      if (missing.length > 0 && originalArchive) {
        for (const [hash, data] of extractFigImages(originalArchive.buffer, missing)) {
          images.push([hash, data])
          transfer.push(data.buffer)
        }
      }
      port?.postMessage({ type: 'images-result', requestId: request.requestId, images }, transfer)
      return
    }
    if (request.type === 'dispose') {
      graph = undefined
      originalArchive = undefined
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
  const isFirstPageOpen = request.options?.populate === 'first-page'
  try {
    const { nodeChanges, blobs, images, figKiwiVersion, figSchemaDeflated } = parseFigBuffer(
      request.buffer,
      (pages) => respond({ type: 'page-manifest', pages }),
      { limitToFirstPage: isFirstPageOpen }
    )
    const parsedGraph = importNodeChanges(nodeChanges, blobs, new Map(images), request.options)
    parsedGraph.figKiwiVersion = figKiwiVersion
    parsedGraph.figSchemaDeflated = figSchemaDeflated
    graph = isFirstPageOpen ? parsedGraph : undefined

    const serialized = serializeSceneGraph(parsedGraph)
    // For a lazily-populated open, archive.ts's parseFigBuffer (above)
    // already decompressed only the first page's (+ its component
    // pages') images — so graph.images only has that subset to begin
    // with. This filter is a defensive backstop matching that same page
    // set via the SceneGraph instead, in case any node ended up
    // referencing an image hash that wasn't actually decompressed (e.g.
    // a malformed file) — serializeSceneGraph would otherwise happily
    // clone an `images` array whose count might not match what's really
    // needed. Later 'images' requests only make sense for hashes this
    // graph actually retains; see the 'images' handler below.
    if (graph) {
      const activeRootIds = getLazyFigImportContext(graph)?.populatedRootIds
      if (activeRootIds) {
        const initialHashes = collectImageHashes(graph, activeRootIds)
        serialized.images = serialized.images.filter(([hash]) => initialHashes.has(hash))
      }
    }
    respond({ type: 'graph', graph: serialized })
  } catch (error) {
    respond({ type: 'graph', error: error instanceof Error ? error.message : String(error) })
  }
}
