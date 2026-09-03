import { parseFigBuffer } from '@open-pencil/fig'
import type { FigPageManifestEntry } from '@open-pencil/kiwi/fig'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { IS_BROWSER } from '#core/constants'
import { importNodeChanges } from '#core/kiwi/fig/import'
import { deserializeSceneGraph } from '#core/kiwi/fig/parse/transfer'
import {
  registerFigPopulationWorker,
  registerImagesRequest,
  registerOriginalArchiveRequest
} from '#core/kiwi/fig/population/client'
import { createFigSessionWorker } from '#core/kiwi/fig/session/client'
import type { FigSessionOpenRequest, FigSessionResponse } from '#core/kiwi/fig/session/protocol'
import { randomHex } from '#core/random'

export interface ParseFigFileOptions {
  populate?: 'all' | 'first-page' | 'none'
  onPages?: (pages: readonly FigPageManifestEntry[]) => void
  signal?: AbortSignal
}

function parseFigFileSync(buffer: ArrayBuffer, options: ParseFigFileOptions = {}): SceneGraph {
  const {
    nodeChanges,
    blobs,
    images: imageEntries,
    figKiwiVersion,
    figSchemaDeflated
  } = parseFigBuffer(buffer, options.onPages)
  const graph = importNodeChanges(nodeChanges, blobs, new Map(imageEntries), options)
  graph.figKiwiVersion = figKiwiVersion
  graph.figSchemaDeflated = figSchemaDeflated
  return graph
}

function parseViaWorker(
  buffer: ArrayBuffer,
  options: ParseFigFileOptions,
  transferOwnership = false
): Promise<SceneGraph> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted()
    const worker = createFigSessionWorker()
    const channel = new MessageChannel()
    const pendingArchives = new Map<string, (bytes: Uint8Array) => void>()
    const pendingImages = new Map<string, (images: Array<[string, Uint8Array]>) => void>()
    const abort = () => {
      channel.port1.postMessage({ type: 'dispose' })
      channel.port1.close()
      worker.terminate()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    const cleanupAbort = () => options.signal?.removeEventListener('abort', abort)

    channel.port1.onmessage = (e: MessageEvent<FigSessionResponse>) => {
      if (e.data.type === 'original-archive-result') {
        const resolveArchive = pendingArchives.get(e.data.requestId)
        if (!resolveArchive) return
        pendingArchives.delete(e.data.requestId)
        resolveArchive(e.data.bytes)
        return
      }
      if (e.data.type === 'images-result') {
        const resolveImages = pendingImages.get(e.data.requestId)
        if (!resolveImages) return
        pendingImages.delete(e.data.requestId)
        resolveImages(e.data.images)
        return
      }
      if (e.data.type === 'page-manifest') {
        options.onPages?.(e.data.pages)
        return
      }
      if (e.data.type !== 'graph') return
      if (e.data.error || !e.data.graph) {
        cleanupAbort()
        channel.port1.close()
        worker.terminate()
        reject(new Error(e.data.error ?? 'Worker failed to parse .fig file'))
        return
      }
      try {
        const graph = deserializeSceneGraph(e.data.graph)
        if (options.populate === 'first-page') {
          cleanupAbort()
          registerFigPopulationWorker(graph, worker, channel.port1)
          registerOriginalArchiveRequest(
            graph,
            () =>
              new Promise<Uint8Array>((resolveArchive) => {
                const requestId = randomHex()
                pendingArchives.set(requestId, resolveArchive)
                channel.port1.postMessage({ type: 'original-archive', requestId })
              })
          )
          registerImagesRequest(
            graph,
            (hashes) =>
              new Promise<Array<[string, Uint8Array]>>((resolveImages) => {
                const requestId = randomHex()
                pendingImages.set(requestId, resolveImages)
                channel.port1.postMessage({ type: 'images', requestId, hashes })
              })
          )
        } else {
          cleanupAbort()
          channel.port1.close()
          worker.terminate()
        }
        resolve(graph)
      } catch (error) {
        cleanupAbort()
        channel.port1.close()
        worker.terminate()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    channel.port1.start()
    worker.onerror = (err) => {
      cleanupAbort()
      channel.port1.close()
      worker.terminate()
      reject(new Error(err.message || 'Worker failed to parse .fig file'))
    }
    // One copy, transferred (not cloned) to the worker — it both parses
    // from this buffer and retains it as the archive snapshot. Sending two
    // independent duplicates here used to double the peak memory cost for
    // every file open, which mattered a lot for large (100MB+) .fig files.
    // transferOwnership skips even this one remaining copy when the
    // caller doesn't need `buffer` to stay valid afterward (readFigFile:
    // it can just re-read the file fresh on the rare worker failure,
    // instead of always paying for a spare copy just in case).
    const transferBuffer = transferOwnership ? buffer : buffer.slice(0)
    const request: FigSessionOpenRequest = {
      type: 'open',
      buffer: transferBuffer,
      options: { populate: options.populate },
      port: channel.port2
    }
    worker.postMessage(request, [transferBuffer, channel.port2])
  })
}

export async function parseFigFile(
  buffer: ArrayBuffer,
  options: ParseFigFileOptions = {}
): Promise<SceneGraph> {
  options.signal?.throwIfAborted()
  if (typeof Worker !== 'undefined' && IS_BROWSER) {
    // parseViaWorker only ever transfers its own internal slice of `buffer`
    // (see transferBuffer below), never `buffer` itself — so it's still
    // valid here on failure, with no need to pre-copy it "just in case"
    // on every open (that copy used to cost a full extra file-size
    // allocation on the common, successful path too).
    try {
      return await parseViaWorker(buffer, options)
    } catch (error) {
      if (options.signal?.aborted) throw error
      console.warn('Worker parsing failed, falling back to main thread:', error)
      const graph = parseFigFileSync(buffer, options)
      registerOriginalArchiveRequest(graph, async () => new Uint8Array(buffer.slice(0)))
      return graph
    }
  }
  options.signal?.throwIfAborted()
  return parseFigFileSync(buffer, options)
}

export async function readFigFile(
  file: File,
  options: ParseFigFileOptions = {}
): Promise<SceneGraph> {
  options.signal?.throwIfAborted()
  const buffer = await file.arrayBuffer()
  options.signal?.throwIfAborted()

  if (typeof Worker === 'undefined' || !IS_BROWSER) {
    return parseFigFileSync(buffer, options)
  }

  try {
    // Transfers `buffer` itself to the worker (no spare copy) — unlike
    // parseFigFile's usual safety copy, readFigFile can just re-read the
    // file fresh below if the worker fails, since it still has `file`.
    // For a single very large file, reading it is already a big
    // allocation on its own; routinely doubling that "just in case" made
    // large opens more likely to hit memory limits well below what the
    // system actually has available.
    return await parseViaWorker(buffer, options, true)
  } catch (error) {
    if (options.signal?.aborted) throw error
    console.warn('Worker parsing failed, falling back to main thread:', error)
    const retryBuffer = await file.arrayBuffer()
    options.signal?.throwIfAborted()
    const graph = parseFigFileSync(retryBuffer, options)
    registerOriginalArchiveRequest(graph, async () => new Uint8Array(retryBuffer.slice(0)))
    return graph
  }
}
