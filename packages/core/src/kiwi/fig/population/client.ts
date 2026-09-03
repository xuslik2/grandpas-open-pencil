import type { SceneGraph } from '@open-pencil/scene-graph'

import { getLazyFigImportContext } from '#core/kiwi/fig/lazy-import'
import type { FigSessionResponse } from '#core/kiwi/fig/session/protocol'
import { randomHex } from '#core/random'

import { applyFigPopulationDelta, type FigPopulationDelta } from './delta'

interface PopulationResult {
  type: 'population-result'
  requestId: string
  baseRevision: number
  populated: boolean
  delta: FigPopulationDelta
}
type WorkerResult = PopulationResult | { type: 'population-error'; error: string }

const MAX_FIG_POPULATION_WORKER_NODES = 200_000
const FIG_POPULATION_WORKER_TIMEOUT_MS = 30_000
const populationWorkers = new WeakMap<SceneGraph, FigPopulationWorker>()
interface OriginalArchiveRequest {
  request: () => Promise<Uint8Array>
  valid: boolean
  unbind: () => void
}
const originalArchiveRequests = new WeakMap<SceneGraph, OriginalArchiveRequest>()

export interface FigPopulationWorkerTelemetry {
  event: 'registered' | 'populate' | 'fallback' | 'stale' | 'terminated'
  reason?: 'oversized' | 'graph-mutation' | 'worker-error'
  durationMs?: number
  applyMs?: number
  created?: number
  updated?: number
  deleted?: number
}

function emitTelemetry(detail: FigPopulationWorkerTelemetry): void {
  if (typeof globalThis.dispatchEvent !== 'function') return
  globalThis.dispatchEvent(new CustomEvent('openpencil:fig-population-worker', { detail }))
}

export function registerFigPopulationWorker(
  graph: SceneGraph,
  worker: Worker,
  port?: MessagePort
): void {
  if (graph.nodes.size > MAX_FIG_POPULATION_WORKER_NODES) {
    emitTelemetry({ event: 'fallback', reason: 'oversized' })
    if (!port) {
      worker.terminate()
      return
    }
    populationWorkers.set(graph, createDisposalOnlyWorker(worker, port))
    return
  }
  const client = createPopulationWorkerClient(graph, worker, port)
  populationWorkers.set(graph, client)
  emitTelemetry({ event: 'registered' })
}

function isDevelopmentBuild(env?: { DEV?: boolean }): boolean {
  return env?.DEV ?? false
}

export function canUseFigPopulationWorker(graph: SceneGraph): boolean {
  return (
    isDevelopmentBuild(import.meta.env) &&
    populationWorkers.has(graph) &&
    getLazyFigImportContext(graph) !== undefined
  )
}

export function registerOriginalArchiveRequest(
  graph: SceneGraph,
  request: () => Promise<Uint8Array>
): void {
  const entry: OriginalArchiveRequest = { request, valid: true, unbind: () => undefined }
  const invalidate = () => {
    if (!graph.isApplyingLayout) entry.valid = false
  }
  entry.unbind = graph.onNodeEvents({
    created: invalidate,
    updated: invalidate,
    deleted: invalidate,
    reparented: invalidate,
    reordered: invalidate
  })
  originalArchiveRequests.set(graph, entry)
}

export async function requestOriginalArchive(graph: SceneGraph): Promise<Uint8Array | null> {
  const entry = originalArchiveRequests.get(graph)
  if (!entry?.valid) return null
  const archive = await entry.request()
  return originalArchiveRequests.get(graph)?.valid === true &&
    originalArchiveRequests.get(graph) === entry
    ? archive
    : null
}

// Requests specific image hashes (by content hash, not by page) from
// whatever still holds the full decompressed set — the session worker,
// for a document opened with populate: 'first-page'. Only the images
// actually needed for the page being shown (or, for export, the images
// referenced anywhere in the fully-populated graph) get fetched, instead
// of every image in the file being decompressed and held in memory
// twice (worker + main thread) up front — see image-refs.ts.
const imagesRequests = new WeakMap<
  SceneGraph,
  (hashes: string[]) => Promise<Array<[string, Uint8Array]>>
>()

export function registerImagesRequest(
  graph: SceneGraph,
  request: (hashes: string[]) => Promise<Array<[string, Uint8Array]>>
): void {
  imagesRequests.set(graph, request)
}

export async function requestMissingImages(
  graph: SceneGraph,
  hashes: string[]
): Promise<Array<[string, Uint8Array]>> {
  if (hashes.length === 0) return []
  const request = imagesRequests.get(graph)
  if (!request) return []
  return request(hashes)
}

/**
 * Fetches and merges into `targetImages` whichever of `hashes` aren't
 * already present. `requestGraph` is whichever graph has a fetcher
 * registered (registerImagesRequest) — usually the same graph as
 * `targetImages`' owner, except during export, where `targetImages`
 * belongs to a throwaway clone but the fetcher lives on the original.
 */
// Images are fetched a few at a time rather than all at once. A single
// page of a media-heavy document can reference well over a hundred
// images totalling hundreds of megabytes; asking for them in one request
// made the worker decompress and copy that whole set simultaneously,
// which is a large enough sudden allocation to take down the renderer
// (confirmed: it crashed mid-switchPage on a 163MB file). Bounded
// batches keep peak memory to roughly one batch at a time.
const IMAGE_FETCH_BATCH_SIZE = 8

export async function ensureImagesLoaded(
  requestGraph: SceneGraph,
  targetImages: Map<string, Uint8Array>,
  hashes: Iterable<string>
): Promise<void> {
  const missing = [...hashes].filter((hash) => !targetImages.has(hash))
  if (missing.length === 0) return
  for (let index = 0; index < missing.length; index += IMAGE_FETCH_BATCH_SIZE) {
    const batch = missing.slice(index, index + IMAGE_FETCH_BATCH_SIZE)
    const fetched = await requestMissingImages(requestGraph, batch)
    for (const [hash, data] of fetched) targetImages.set(hash, data)
  }
}

export function releaseFigPopulationWorker(graph: SceneGraph): void {
  populationWorkers.get(graph)?.terminate()
  populationWorkers.delete(graph)
  originalArchiveRequests.get(graph)?.unbind()
  originalArchiveRequests.delete(graph)
  imagesRequests.delete(graph)
}

export interface FigPopulationWorker {
  populate: (pageId: string, signal?: AbortSignal) => Promise<boolean | null>
  terminate: () => void
}

function createDisposalOnlyWorker(worker: Worker, port: MessagePort): FigPopulationWorker {
  let disposed = false
  return {
    populate: () => Promise.resolve(null),
    terminate() {
      if (disposed) return
      disposed = true
      emitTelemetry({ event: 'terminated' })
      port.postMessage({ type: 'dispose' })
      port.close()
      worker.terminate()
    }
  }
}

export function createFigPopulationWorker(graph: SceneGraph): FigPopulationWorker | null {
  if (!canUseFigPopulationWorker(graph)) return null
  return populationWorkers.get(graph) ?? null
}

function createPopulationWorkerClient(
  graph: SceneGraph,
  worker: Worker,
  port?: MessagePort
): FigPopulationWorker {
  const pending = new Map<
    string,
    {
      resolve: (value: boolean | null) => void
      abort?: () => void
      revision: number
      startedAt: number
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  let revision = 0
  let stale = false
  let disposed = false
  let applyingDelta = false
  const invalidate = () => {
    // Layout recomputation (import-time or after a switch) is derived from the
    // same scene graph the worker deltas were built from; it must not count as
    // user divergence. Only real user edits invalidate the worker.
    if (applyingDelta || stale || graph.isApplyingLayout) return
    revision++
    stale = true
    emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
  }
  let unbind: (() => void) | undefined
  const releaseSubscription = () => {
    unbind?.()
    unbind = undefined
  }
  const fail = (emit = true) => {
    stale = true
    if (emit) emitTelemetry({ event: 'fallback', reason: 'worker-error' })
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.abort?.()
      request.resolve(null)
    }
    pending.clear()
    releaseSubscription()
    worker.terminate()
    populationWorkers.delete(graph)
  }
  unbind = graph.onNodeEvents({
    created: invalidate,
    updated: invalidate,
    deleted: invalidate,
    reparented: invalidate,
    reordered: invalidate
  })
  const receive = (result: WorkerResult) => {
    if (result.type === 'population-error') return fail()
    const request = pending.get(result.requestId)
    if (!request) return
    clearTimeout(request.timeout)
    request.abort?.()
    pending.delete(result.requestId)
    if (stale || revision !== request.revision || result.baseRevision !== request.revision) {
      emitTelemetry({ event: 'stale', reason: 'graph-mutation' })
      return request.resolve(null)
    }
    applyingDelta = true
    const applyStartedAt = performance.now()
    try {
      applyFigPopulationDelta(graph, result.delta)
      const context = getLazyFigImportContext(graph)
      if (context) context.populatedRootIds = new Set(result.delta.populatedRootIds)
    } catch {
      applyingDelta = false
      fail()
      return request.resolve(null)
    } finally {
      applyingDelta = false
    }
    request.resolve(result.populated)
    emitTelemetry({
      event: 'populate',
      durationMs: performance.now() - request.startedAt,
      applyMs: performance.now() - applyStartedAt,
      created: result.delta.created.length,
      updated: result.delta.updated.length,
      deleted: result.delta.deleted.length
    })
  }
  if (port) {
    // registerOriginalArchiveRequest (see read.ts) shares this same port
    // for its own 'original-archive-result' responses, set up before this
    // handler replaces port.onmessage. Chain to whatever was already
    // there for message types this client doesn't own, instead of
    // silently dropping them — previously, requesting the original
    // archive (exportFigFile's fast path, hit by any save/export of an
    // unmodified freshly-imported document) hung forever, since its
    // response arrived here and matched neither 'population-error' nor
    // any pending population request, so receive() just returned.
    const previousOnMessage = port.onmessage
    port.onmessage = (event: MessageEvent<FigSessionResponse>) => {
      const data = event.data as WorkerResult
      if (data.type === 'population-result' || data.type === 'population-error') {
        receive(data)
        return
      }
      previousOnMessage?.call(port, event)
    }
    port.start()
  } else {
    worker.onmessage = (event: MessageEvent<WorkerResult>) => receive(event.data)
  }
  worker.onerror = () => fail()
  return {
    populate(pageId, signal) {
      signal?.throwIfAborted()
      if (stale) return Promise.resolve(null)
      const requestId = randomHex()
      const baseRevision = revision
      return new Promise((resolve, reject) => {
        const abort = () => {
          const request = pending.get(requestId)
          if (!request) return
          clearTimeout(request.timeout)
          pending.delete(requestId)
          fail(false)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', abort, { once: true })
        const timeout = setTimeout(() => fail(), FIG_POPULATION_WORKER_TIMEOUT_MS)
        pending.set(requestId, {
          resolve,
          abort: () => signal?.removeEventListener('abort', abort),
          revision: baseRevision,
          startedAt: performance.now(),
          timeout
        })
        if (port) port.postMessage({ type: 'populate', requestId, baseRevision, pageId })
        else worker.postMessage({ type: 'populate', requestId, baseRevision, pageId }, [])
      })
    },
    terminate() {
      if (disposed) return
      disposed = true
      emitTelemetry({ event: 'terminated' })
      port?.postMessage({ type: 'dispose' })
      port?.close()
      fail(false)
    }
  }
}
