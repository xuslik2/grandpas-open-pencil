import type { FigPageManifestEntry } from '@open-pencil/kiwi/fig'

import type { FigImportOptions } from '#core/kiwi/fig/import'
import type { SerializedSceneGraph } from '#core/kiwi/fig/parse/transfer'
import type { FigPopulationDelta } from '#core/kiwi/fig/population/delta'

export interface FigSessionOpenRequest {
  type: 'open'
  /**
   * Exactly one of `file` or `buffer`.
   *
   * `file` is what the browser should use. A Blob is structured-cloned by
   * reference, so handing one to the worker costs nothing and the main
   * thread never materialises the document at all — whereas reading it
   * into an ArrayBuffer first means a full file-size allocation (163MB,
   * for the document that motivated this) on the one thread that has to
   * stay responsive while the file opens.
   *
   * Either way the worker both parses from these bytes and retains them
   * as the archive snapshot; parsing only reads, so one copy safely
   * serves both purposes.
   */
  file?: Blob
  buffer?: ArrayBuffer
  options?: FigImportOptions
  port: MessagePort
}

export interface FigSessionPopulateRequest {
  type: 'populate'
  requestId: string
  baseRevision: number
  pageId: string
}

export interface FigSessionOriginalArchiveRequest {
  type: 'original-archive'
  requestId: string
}

export interface FigSessionImagesRequest {
  type: 'images'
  requestId: string
  hashes: string[]
}

export interface FigSessionCancelRequest {
  type: 'cancel'
  requestId?: string
}

export interface FigSessionDisposeRequest {
  type: 'dispose'
}

export type FigSessionRequest =
  | FigSessionPopulateRequest
  | FigSessionOriginalArchiveRequest
  | FigSessionImagesRequest
  | FigSessionCancelRequest
  | FigSessionDisposeRequest

export type FigSessionResponse =
  | { type: 'page-manifest'; pages: FigPageManifestEntry[] }
  | { type: 'graph'; graph?: SerializedSceneGraph; error?: string }
  | {
      type: 'population-result'
      requestId: string
      baseRevision: number
      populated: boolean
      delta: FigPopulationDelta
    }
  | { type: 'population-error'; requestId?: string; error: string }
  | { type: 'original-archive-result'; requestId: string; bytes?: Uint8Array; error?: string }
  | { type: 'images-result'; requestId: string; images: Array<[string, Uint8Array]> }
  | { type: 'disposed' }
