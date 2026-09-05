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
const HEARTBEAT_KEY = 'openpencil:risky-operation-heartbeat'

/**
 * How long a heartbeat can go unrefreshed before the tab that wrote it is
 * presumed dead. A live tab refreshes well inside this; a killed renderer
 * stops instantly.
 */
const HEARTBEAT_STALE_MS = 5000
const HEARTBEAT_INTERVAL_MS = 1500

/** Identifies this page load, so one tab can recognise another's marker. */
const SESSION_ID = `${Math.trunc(performance.timeOrigin)}-${Math.trunc(performance.now() * 1000)}`

export type RiskyOperation = {
  kind: 'sync-upload' | 'document-open'
  canvasId: string
  label: string
  /** Which page load owns this marker. */
  sessionId?: string
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

function clearMarker(): void {
  try {
    localStorage.removeItem(IN_FLIGHT_KEY)
    localStorage.removeItem(HEARTBEAT_KEY)
  } catch {
    // See writeJSON.
  }
}

let heartbeat: ReturnType<typeof setInterval> | null = null

function beat(): void {
  writeJSON(HEARTBEAT_KEY, { sessionId: SESSION_ID, at: Date.now() })
}

export function beginRiskyOperation(operation: RiskyOperation): void {
  writeJSON(IN_FLIGHT_KEY, { ...operation, sessionId: SESSION_ID })
  // A heartbeat, refreshed while the work runs, is what lets another tab
  // tell "someone is busy with this right now" from "a tab died holding
  // this". Without it, opening the app in a second tab during a long
  // upload reads the first tab's live marker and quarantines a document
  // that is uploading perfectly happily.
  beat()
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = setInterval(beat, HEARTBEAT_INTERVAL_MS)
}

export function endRiskyOperation(): void {
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  // Only ever clears this tab's own marker. This also runs on pagehide,
  // so a second tab merely being closed must not wipe the marker
  // protecting an upload still running in the first one.
  const owner = readJSON<RiskyOperation | null>(IN_FLIGHT_KEY, null)
  if (owner && owner.sessionId !== SESSION_ID) return
  try {
    localStorage.removeItem(IN_FLIGHT_KEY)
    localStorage.removeItem(HEARTBEAT_KEY)
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
  if (!operation?.canvasId) {
    clearMarker()
    return null
  }

  // Someone else is still working on it. Leave the marker alone — it
  // belongs to a tab that is alive, and clearing it would both rob that
  // tab of its own guard and quarantine a healthy document.
  const pulse = readJSON<{ sessionId?: string; at?: number } | null>(HEARTBEAT_KEY, null)
  const fresh = typeof pulse?.at === 'number' && Date.now() - pulse.at < HEARTBEAT_STALE_MS
  if (fresh && pulse?.sessionId === operation.sessionId) return null

  // Stale, so its owner is gone. Cleared directly rather than through
  // endRiskyOperation, which by design refuses to touch another
  // session's marker — and this marker is precisely another session's.
  clearMarker()

  const ids = quarantinedCanvasIds()
  ids.add(operation.canvasId)
  writeJSON(QUARANTINE_KEY, [...ids])
  claimed = operation
  return operation
}
