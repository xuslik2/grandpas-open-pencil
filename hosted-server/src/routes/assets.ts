import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db/client.js'
import { requireAuth, requireTeamRole, teamIdFromParam } from '../middleware/authz.js'
import { assetObjectKey, readAtKey, writeAtKey } from '../storage/disk.js'

/**
 * Content-addressed image storage.
 *
 * A .fig is mostly images — for a real 163MB file here, 155MB of it was
 * 138 images and only 138KB was the actual design. Storing those images
 * inside every saved revision meant each autosave moved the whole 163MB
 * through the browser several times over, which is what was killing the
 * renderer. Keeping them out here means a save is just the design.
 *
 * Assets are immutable and keyed by the hash the .fig itself uses, so an
 * image that hasn't changed is uploaded once and then shared by every
 * later revision (and by any other document that embeds the same image).
 *
 * Scoped per team rather than globally: a hash is only knowable to
 * someone who already has the bytes, but team scoping keeps one team's
 * images from being reachable at all from another's session, which is a
 * cheaper thing to guarantee than to reason about.
 */
export const assetRoutes = new Hono()

assetRoutes.use('*', requireAuth)

// Hex digests as they appear in the .fig archive's images/ entries.
const HASH_PATTERN = /^[a-f0-9]{8,128}$/

const missingSchema = z.object({
  hashes: z.array(z.string().regex(HASH_PATTERN)).max(5000),
})

/**
 * Which of these does the server not already have? Lets a client upload
 * only genuinely new images instead of re-sending an entire library on
 * every save — the difference between a few hundred KB and 155MB.
 */
assetRoutes.post(
  '/:teamId/assets/missing',
  requireTeamRole('editor', teamIdFromParam),
  async (c) => {
    const parsed = missingSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid hashes' }, 400)
    if (parsed.data.hashes.length === 0) return c.json({ missing: [] })

    const { rows } = await pool.query(
      `select hash from assets where team_id = $1 and hash = any($2::text[])`,
      [c.req.param('teamId'), parsed.data.hashes]
    )
    const present = new Set(rows.map((r) => r.hash))
    return c.json({ missing: parsed.data.hashes.filter((h) => !present.has(h)) })
  }
)

assetRoutes.put(
  '/:teamId/assets/:hash',
  requireTeamRole('editor', teamIdFromParam),
  async (c) => {
    const teamId = c.req.param('teamId')!
    const hash = c.req.param('hash')!
    if (!HASH_PATTERN.test(hash)) return c.json({ error: 'invalid hash' }, 400)

    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength === 0) return c.json({ error: 'empty asset' }, 400)

    // Immutable by construction, so a re-upload of a hash we already hold
    // is a no-op rather than a conflict — clients racing to save the same
    // newly-added image both succeed.
    await writeAtKey(assetObjectKey(teamId, hash), bytes)
    await pool.query(
      `insert into assets (team_id, hash, size_bytes) values ($1, $2, $3)
       on conflict (team_id, hash) do nothing`,
      [teamId, hash, bytes.byteLength]
    )
    return c.json({ ok: true })
  }
)

assetRoutes.get(
  '/:teamId/assets/:hash',
  requireTeamRole('viewer', teamIdFromParam),
  async (c) => {
    const hash = c.req.param('hash')!
    if (!HASH_PATTERN.test(hash)) return c.json({ error: 'invalid hash' }, 400)

    const bytes = await readAtKey(assetObjectKey(c.req.param('teamId')!, hash))
    if (!bytes) return c.json({ error: 'not found' }, 404)
    // Immutable content at an immutable address, so this can be cached
    // hard — repeat page visits then cost no transfer at all.
    return c.body(bytes, 200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
  }
)
