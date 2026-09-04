import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Hono } from 'hono'
import { requireAuth } from '../middleware/authz.js'

/**
 * Collects traces from document opens that never finished.
 *
 * Large .fig files kill the renderer outright, which destroys the
 * console and network log along with it — so the client records what it
 * was doing to localStorage as it goes and posts the leftovers here on
 * its next load. Written as JSON lines to a file rather than a table:
 * this is short-lived debugging output to be read over SSH, not
 * application data.
 */
export const diagnosticRoutes = new Hono()

diagnosticRoutes.use('*', requireAuth)

const DATA_DIR = process.env.DATA_DIR ?? '/data/hosted'
const TRACE_LOG = join(DATA_DIR, 'diagnostics', 'open-traces.jsonl')
const MAX_TRACE_BYTES = 2_000_000

diagnosticRoutes.post('/open-trace', async (c) => {
  const raw = await c.req.text()
  if (raw.length === 0 || raw.length > MAX_TRACE_BYTES) {
    return c.json({ error: 'invalid trace' }, 400)
  }
  // Parsed only to reject garbage; stored as the client sent it.
  try {
    JSON.parse(raw)
  } catch {
    return c.json({ error: 'invalid trace' }, 400)
  }

  const user = c.get('user')
  const line = JSON.stringify({ receivedAt: new Date().toISOString(), userId: user.id, raw })

  await mkdir(dirname(TRACE_LOG), { recursive: true })
  await appendFile(TRACE_LOG, `${line}\n`, 'utf8')
  return c.json({ ok: true })
})
