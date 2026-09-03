import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db/client.js'
import { deleteAtKey, readAtKey, thumbnailObjectKey, writeAtKey } from '../storage/disk.js'
import { requireAuth, requireTeamRole, teamIdForDocument } from '../middleware/authz.js'

export const documentRoutes = new Hono()
documentRoutes.use('*', requireAuth)

// Flat list of every non-deleted document across every team the user
// belongs to — matches StorageAdapter.listDocuments()'s flat contract.
// projectId/folderId/teamId ride along as extra fields for the dashboard's
// own hierarchy queries; the storage adapter itself only reads id/name/updatedAt.
documentRoutes.get('/', async (c) => {
  const user = c.get('user')
  const { rows } = await pool.query(
    `select d.id, d.name, d.updated_at, d.project_id, d.folder_id, p.team_id,
            (d.thumb_object_key is not null) as has_thumbnail
       from documents d
       join projects p on p.id = d.project_id
       join team_members m on m.team_id = p.team_id
      where m.user_id = $1 and d.deleted_at is null
      order by d.updated_at desc`,
    [user.id]
  )
  return c.json({ documents: rows })
})

documentRoutes.get('/usage', async (c) => {
  const user = c.get('user')
  const { rows } = await pool.query(
    `select count(*)::int as document_count, coalesce(sum(d.size_bytes), 0)::bigint as bytes_used
       from documents d
       join projects p on p.id = d.project_id
       join team_members m on m.team_id = p.team_id
      where m.user_id = $1 and d.deleted_at is null`,
    [user.id]
  )
  return c.json({ documentCount: rows[0].document_count, bytesUsed: Number(rows[0].bytes_used) })
})

documentRoutes.get('/favorites', async (c) => {
  const user = c.get('user')
  const { rows } = await pool.query(
    `select d.id, d.name, d.updated_at, d.project_id, d.folder_id
       from favorites f
       join documents d on d.id = f.document_id
      where f.user_id = $1 and d.deleted_at is null
      order by d.updated_at desc`,
    [user.id]
  )
  return c.json({ documents: rows })
})

documentRoutes.get(
  '/:documentId',
  requireTeamRole('viewer', teamIdForDocument),
  async (c) => {
    const { rows } = await pool.query(
      `select id, project_id, folder_id, name, updated_at, revision,
              (thumb_object_key is not null) as has_thumbnail
         from documents where id = $1 and deleted_at is null`,
      [c.req.param('documentId')]
    )
    if (!rows[0]) return c.json({ error: 'not found' }, 404)
    return c.json({ document: rows[0] })
  }
)

const patchDocumentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  folderId: z.string().uuid().nullable().optional(),
})

documentRoutes.patch(
  '/:documentId',
  requireTeamRole('editor', teamIdForDocument),
  async (c) => {
    const parsed = patchDocumentSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

    const { rows } = await pool.query(
      `update documents set
         name = coalesce($2, name),
         folder_id = case when $3::text is not null then $3::uuid else folder_id end,
         updated_at = now()
       where id = $1 and deleted_at is null
       returning id, project_id, folder_id, name, updated_at, revision`,
      [c.req.param('documentId'), parsed.data.name ?? null, parsed.data.folderId ?? null]
    )
    if (!rows[0]) return c.json({ error: 'not found' }, 404)
    return c.json({ document: rows[0] })
  }
)

// Soft delete — matches the "Trash" view being a deleted_at filter, not a
// separate folder kind (see hosted-server/db/schema.sql).
documentRoutes.delete(
  '/:documentId',
  requireTeamRole('editor', teamIdForDocument),
  async (c) => {
    const { rows } = await pool.query(
      `update documents set deleted_at = now() where id = $1 returning id`,
      [c.req.param('documentId')]
    )
    if (!rows[0]) return c.json({ error: 'not found' }, 404)
    return c.json({ ok: true })
  }
)

documentRoutes.get(
  '/:documentId/content',
  requireTeamRole('viewer', teamIdForDocument),
  async (c) => {
    const { rows } = await pool.query(`select fig_object_key from documents where id = $1`, [
      c.req.param('documentId'),
    ])
    if (!rows[0]) return c.json({ error: 'not found' }, 404)

    const bytes = await readAtKey(rows[0].fig_object_key)
    if (!bytes) return c.json({ error: 'not found' }, 404)
    return c.body(bytes, 200, { 'Content-Type': 'application/octet-stream' })
  }
)

documentRoutes.put(
  '/:documentId/content',
  requireTeamRole('editor', teamIdForDocument),
  async (c) => {
    const { rows } = await pool.query(`select fig_object_key from documents where id = $1`, [
      c.req.param('documentId'),
    ])
    if (!rows[0]) return c.json({ error: 'not found' }, 404)

    const bytes = new Uint8Array(await c.req.arrayBuffer())
    await writeAtKey(rows[0].fig_object_key, bytes)

    const { rows: updated } = await pool.query(
      `update documents set updated_at = now(), revision = revision + 1, size_bytes = $2
       where id = $1 returning revision`,
      [c.req.param('documentId'), bytes.byteLength]
    )
    return c.json({ ok: true, revision: updated[0].revision })
  }
)

documentRoutes.get(
  '/:documentId/thumbnail',
  requireTeamRole('viewer', teamIdForDocument),
  async (c) => {
    const { rows } = await pool.query(`select thumb_object_key from documents where id = $1`, [
      c.req.param('documentId'),
    ])
    if (!rows[0]?.thumb_object_key) return c.json({ error: 'not found' }, 404)

    const bytes = await readAtKey(rows[0].thumb_object_key)
    if (!bytes) return c.json({ error: 'not found' }, 404)
    return c.body(bytes, 200, { 'Content-Type': 'image/jpeg' })
  }
)

documentRoutes.put(
  '/:documentId/thumbnail',
  requireTeamRole('editor', teamIdForDocument),
  async (c) => {
    // Non-null: guaranteed present by the matched :documentId route pattern —
    // TS can't see that through the generic Context type our middleware uses.
    const documentId = c.req.param('documentId')!
    const key = thumbnailObjectKey(documentId)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    await writeAtKey(key, bytes)

    await pool.query(`update documents set thumb_object_key = $2 where id = $1`, [
      documentId,
      key,
    ])
    return c.json({ ok: true })
  }
)

documentRoutes.post(
  '/:documentId/favorite',
  requireTeamRole('viewer', teamIdForDocument),
  async (c) => {
    const user = c.get('user')
    await pool.query(
      `insert into favorites (user_id, document_id) values ($1, $2)
       on conflict do nothing`,
      [user.id, c.req.param('documentId')]
    )
    return c.json({ ok: true })
  }
)

documentRoutes.delete(
  '/:documentId/favorite',
  requireTeamRole('viewer', teamIdForDocument),
  async (c) => {
    const user = c.get('user')
    await pool.query(`delete from favorites where user_id = $1 and document_id = $2`, [
      user.id,
      c.req.param('documentId'),
    ])
    return c.json({ ok: true })
  }
)
