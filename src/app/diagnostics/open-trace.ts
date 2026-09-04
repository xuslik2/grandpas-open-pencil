/**
 * Records what a document open was doing, in a way that survives the tab
 * dying.
 *
 * Large .fig files here kill the renderer outright ("Aw, Snap", error
 * code 5), which takes the console, the network log and any in-memory
 * state with it — so the only evidence of what happened has to already be
 * on disk when the process goes. Samples are written synchronously to
 * localStorage as they're taken; on the next load, a trace that never
 * recorded a clean finish is uploaded to the server, where it can be read
 * after the fact.
 *
 * Deliberately cheap: a bounded ring buffer, one small synchronous write
 * per sample, and no network I/O at all while a document is opening.
 */

const STORAGE_KEY = 'openpencil:open-trace'
const MAX_SAMPLES = 600
const SAMPLE_INTERVAL_MS = 250

type Sample = {
  t: number
  phase: string
  detail?: string | null
  /** Megabytes; Chrome-only, absent elsewhere. */
  usedMB?: number
  totalMB?: number
  limitMB?: number
}

type Trace = {
  startedAt: string
  subject: string | null
  kind: string
  fileBytes: number | null
  deviceMemoryGB: number | null
  hardwareConcurrency: number | null
  userAgent: string
  outcome: 'in-progress' | 'completed' | 'failed' | 'cancelled'
  failure?: string
  samples: Sample[]
}

type ChromeMemory = { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }

function memory(): Partial<Sample> {
  const m = (performance as Performance & { memory?: ChromeMemory }).memory
  if (!m) return {}
  const mb = (bytes: number) => Math.round(bytes / 1048576)
  return { usedMB: mb(m.usedJSHeapSize), totalMB: mb(m.totalJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) }
}

let active: Trace | null = null
let timer: ReturnType<typeof setInterval> | null = null
let currentPhase = 'starting'
let currentDetail: string | null = null

function persist(): void {
  if (!active) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(active))
  } catch {
    // Private browsing, quota, blocked storage — losing the trace is
    // strictly better than breaking the open it was meant to observe.
  }
}

function sample(): void {
  if (!active) return
  active.samples.push({
    t: Math.round(performance.now()),
    phase: currentPhase,
    detail: currentDetail,
    ...memory()
  })
  // Keep the *first* samples as well as the last: a crash 30s in is
  // still best understood alongside how the open began.
  if (active.samples.length > MAX_SAMPLES) active.samples.splice(MAX_SAMPLES / 2, 1)
  persist()
}

export function beginOpenTrace(options: {
  kind: string
  subject: string | null
  fileBytes?: number | null
}): void {
  const nav = navigator as Navigator & { deviceMemory?: number }
  active = {
    startedAt: new Date().toISOString(),
    subject: options.subject,
    kind: options.kind,
    fileBytes: options.fileBytes ?? null,
    deviceMemoryGB: nav.deviceMemory ?? null,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    userAgent: navigator.userAgent,
    outcome: 'in-progress',
    samples: []
  }
  currentPhase = 'starting'
  currentDetail = options.subject
  sample()
  if (timer) clearInterval(timer)
  timer = setInterval(sample, SAMPLE_INTERVAL_MS)
}

export function markOpenTracePhase(phase: string, detail?: string | null): void {
  if (!active) return
  currentPhase = phase
  currentDetail = detail ?? null
  // Sampled immediately as well as on the timer, so the exact moment a
  // phase begins is always in the trace even if the tab dies mid-phase.
  sample()
}

export function endOpenTrace(outcome: 'completed' | 'failed' | 'cancelled', failure?: string): void {
  if (!active) return
  active.outcome = outcome
  if (failure) active.failure = failure
  sample()
  if (timer) clearInterval(timer)
  timer = null
  active = null
}

/**
 * Uploads a trace left behind by a previous session that never finished
 * — which, for the crashes this exists to diagnose, is the only kind
 * that matters. Runs once at startup and clears the slot either way.
 */
export async function reportAbandonedOpenTrace(): Promise<void> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    return
  }
  if (!raw) return

  let trace: Trace
  try {
    trace = JSON.parse(raw) as Trace
  } catch {
    return
  }
  // A clean finish is the normal case and isn't worth reporting.
  if (trace.outcome === 'completed' || trace.outcome === 'cancelled') return

  try {
    await fetch('/api/diagnostics/open-trace', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: raw
    })
  } catch {
    // Best effort. The trace is a diagnostic, not something to retry.
  }
}
