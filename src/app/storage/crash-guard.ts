/**
 * Stops one document from making the app unopenable.
 *
 * Some work — uploading a pending document, opening a very large one — can
 * kill the renderer outright rather than throwing. When that work is
 * started automatically at page load, the result is a loop: the tab dies,
 * the user reloads, the same work starts again, the tab dies again. The
 * site becomes unreachable and nothing in the app ever gets to run.
 *
 * So: write down what is about to be attempted *before* attempting it, and
 * clear it on the way out. A marker still present at startup means the
 * previous attempt never returned — the process died mid-way. That
 * document goes into quarantine, where automatic work skips it until the
 * user asks for it explicitly.
 *
 * localStorage rather than IndexedDB on purpose: writes are synchronous
 * and already flushed when the process is killed, which is exactly the
 * case this has to survive.
 */

const IN_FLIGHT_KEY = 'openpencil:risky-operation'
const QUARANTINE_KEY = 'openpencil:quarantined-canvases'

export type RiskyOperation = {
  kind: 'sync-upload' | 'document-open'
  canvasId: string
  label: string
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable (private mode, quota). The guard degrades to
    // doing nothing, which is the behaviour that existed before it.
  }
}

export function beginRiskyOperation(operation: RiskyOperation): void {
  writeJSON(IN_FLIGHT_KEY, operation)
}

export function endRiskyOperation(): void {
  try {
    localStorage.removeItem(IN_FLIGHT_KEY)
  } catch {
    // See writeJSON.
  }
}

export function quarantinedCanvasIds(): Set<string> {
  return new Set(readJSON<string[]>(QUARANTINE_KEY, []))
}

export function isQuarantined(canvasId: string): boolean {
  return quarantinedCanvasIds().has(canvasId)
}

/** Lets the user opt back in to a document the guard has been skipping. */
export function releaseQuarantine(canvasId: string): void {
  const ids = quarantinedCanvasIds()
  if (!ids.delete(canvasId)) return
  writeJSON(QUARANTINE_KEY, [...ids])
}

/**
 * Called once at startup, before any automatic work begins. Returns the
 * operation that was in flight when the process died, if there was one,
 * and quarantines the document it was working on.
 */
let claimed: RiskyOperation | null = null

/** What claimCrashedOperation() found this session, for the UI to report. */
export function lastClaimedCrash(): RiskyOperation | null {
  return claimed
}

export function claimCrashedOperation(): RiskyOperation | null {
  const operation = readJSON<RiskyOperation | null>(IN_FLIGHT_KEY, null)
  endRiskyOperation()
  if (!operation?.canvasId) return null

  const ids = quarantinedCanvasIds()
  ids.add(operation.canvasId)
  writeJSON(QUARANTINE_KEY, [...ids])
  claimed = operation
  return operation
}
