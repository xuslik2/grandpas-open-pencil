import { watch } from 'vue'

import type { EditorState } from '@open-pencil/core/editor'

type AutosaveState = EditorState & { autosaveEnabled: boolean }

type AutosaveOptions = {
  state: AutosaveState
  getSavedVersion: () => number
  hasWritableSource: () => boolean
  saveCurrentDocument: (version: number) => Promise<void>
  /** Byte size of the last document written, when one has been. */
  getLastDocumentBytes?: () => number | null
}

// A .fig save always rewrites the whole document — the format has no
// partial write, so every save costs the full encode plus upload. For a
// small document that's cheap enough to do the moment you pause typing;
// for a 100MB+ one it's minutes of work per keystroke-pause. These
// thresholds trade a little staleness for not saturating the machine,
// and leave small documents exactly as responsive as before.
const AUTOSAVE_DELAY_STEPS: Array<{ maxBytes: number; delay: number }> = [
  { maxBytes: 5_000_000, delay: 400 },
  { maxBytes: 25_000_000, delay: 2_000 },
  { maxBytes: 100_000_000, delay: 8_000 }
]
const AUTOSAVE_DELAY_MAX = 20_000

export function autosaveDelayForBytes(bytes: number | null): number {
  if (bytes === null) return AUTOSAVE_DELAY_STEPS[0].delay
  return AUTOSAVE_DELAY_STEPS.find((step) => bytes <= step.maxBytes)?.delay ?? AUTOSAVE_DELAY_MAX
}

export function createAutosave({
  state,
  getSavedVersion,
  hasWritableSource,
  saveCurrentDocument,
  getLastDocumentBytes
}: AutosaveOptions) {
  let requestedVersion: number | null = null
  let saving: Promise<void> | null = null
  let disposed = false

  function canSave(version: number) {
    return version > getSavedVersion() && state.autosaveEnabled && hasWritableSource()
  }

  async function runSaves() {
    while (requestedVersion !== null) {
      if (disposed) return
      const version = requestedVersion
      requestedVersion = null
      if (!canSave(version)) continue
      await saveCurrentDocument(version)
    }
  }

  function reportFailure(error: unknown) {
    console.warn('Autosave failed:', error)
  }

  function requestSave(version: number): Promise<void> {
    if (disposed || !canSave(version)) return Promise.resolve()
    requestedVersion = Math.max(requestedVersion ?? version, version)
    if (!saving) {
      saving = runSaves().finally(() => {
        saving = null
        if (!disposed && requestedVersion !== null) {
          void requestSave(requestedVersion).catch(reportFailure)
        }
      })
    }
    return saving
  }

  // Short debounce for ordinary documents: batches a rapid burst of
  // changes within one action (every intermediate frame of a drag, each
  // keystroke while typing) into a single save, but fires very shortly
  // after the action ends rather than requiring seconds of idle time —
  // "auto save within each action", not "auto save after a long pause".
  // The interval is recomputed per change so a document that turns out to
  // be huge backs off instead of rewriting hundreds of megabytes between
  // keystrokes; the debounce is hand-rolled rather than watchDebounced
  // for exactly that (the delay has to be read at trigger time).
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = watch(
    () => state.sceneVersion,
    (version) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void requestSave(version).catch(reportFailure)
      }, autosaveDelayForBytes(getLastDocumentBytes?.() ?? null))
    }
  )

  return {
    requestSave,
    disposeAutosave() {
      disposed = true
      requestedVersion = null
      if (timer) clearTimeout(timer)
      timer = undefined
      stop()
    }
  }
}
