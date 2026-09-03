import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db/client.js'
import { documentObjectKey, writeAtKey } from '../storage/disk.js'
import {
  requireAuth,
  requireTeamRole,
  teamIdForProject,
  teamIdForFolder,
} from '../middleware/authz.js'

export const projectRoutes = new Hono()

projectRoutes.use('*', requireAuth)

const patchProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
})

projectRoutes.get('/:projectId', requireTeamRole('viewer', teamIdForProject), async (c) => {
  const { rows } = await pool.query(
    `select id, team_id, name, created_by, created_at, archived_at from projects where id = $1`,
    [c.req.param('projectId')]
  )
  if (!rows[0]) return c.json({ error: 'not found' }, 404)
  return c.json({ project: rows[0] })
})

// Documents within one project — what the dashboard shows when you click
// into a project card. Distinct from the flat /documents resource, which
// spans every project the user can see.
projectRoutes.get(
  '/:projectId/documents',
  requireTeamRole('viewer', teamIdForProject),
  async (c) => {
    const { rows } = await pool.query(
      `select id, name, updated_at, folder_id, (thumb_object_key is not null) as has_thumbnail
         from documents
        where project_id = $1 and deleted_at is null
        order by updated_at desc`,
      [c.req.param('projectId')]
    )
    return c.json({ documents: rows })
  }
)

projectRoutes.patch('/:projectId', requireTeamRole('editor', teamIdForProject), async (c) => {
  const parsed = patchProjectSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const { rows } = await pool.query(
    `update projects set
       name = coalesce($2, name),
       archived_at = case
         when $3::boolean is true then now()
         when $3::boolean is false then null
         else archived_at
       end
     where id = $1
     returning id, team_id, name, created_by, created_at, archived_at`,
    [c.req.param('projectId'), parsed.data.name ?? null, parsed.data.archived ?? null]
  )
  if (!rows[0]) return c.json({ error: 'not found' }, 404)
  return c.json({ project: rows[0] })
})

// Folders within a project — nested here rather than a standalone /folders
// resource, since they're always listed in the context of a project.
projectRoutes.get(
  '/:projectId/folders',
  requireTeamRole('viewer', teamIdForProject),
  async (c) => {
    const { rows } = await pool.query(
      `select id, project_id, parent_folder_id, name, created_at
         from folders where project_id = $1
        order by name`,
      [c.req.param('projectId')]
    )
    return c.json({ folders: rows })
  }
)

const createFolderSchema = z.object({
  name: z.string().min(1).max(200),
  parentFolderId: z.string().uuid().nullable().optional(),
})

projectRoutes.post(
  '/:projectId/folders',
  requireTeamRole('editor', teamIdForProject),
  async (c) => {
    const parsed = createFolderSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

    const { rows } = await pool.query(
      `insert into folders (project_id, parent_folder_id, name) values ($1, $2, $3)
       returning id, project_id, parent_folder_id, name, created_at`,
      [c.req.param('projectId'), parsed.data.parentFolderId ?? null, parsed.data.name]
    )
    return c.json({ folder: rows[0] }, 201)
  }
)

const createDocumentSchema = z.object({
  id: z.string().uuid().optional(), // let the caller choose (e.g. the editor's own local id)
  name: z.string().min(1).max(200).default('Untitled'),
  folderId: z.string().uuid().nullable().optional(),
})

// Creating a document needs a project to attach it to, so it lives here
// rather than on the flat /documents resource. Starts with empty content;
// the editor pushes real bytes via PUT /documents/:id/content right after.
projectRoutes.post(
  '/:projectId/documents',
  requireTeamRole('editor', teamIdForProject),
  async (c) => {
    const parsed = createDocumentSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

    const user = c.get('user')
    const projectId = c.req.param('projectId')! // guaranteed by the matched route
    const documentId = parsed.data.id ?? crypto.randomUUID()
    const objectKey = documentObjectKey(projectId, documentId)

    // Idempotent on id: the adapter may retry a create after a network
    // failure without knowing whether the first attempt landed.
    const { rows } = await pool.query(
      `insert into documents (id, project_id, folder_id, name, created_by, fig_object_key)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set id = excluded.id
       returning id, project_id, folder_id, name, updated_at, created_by, revision`,
      [documentId, projectId, parsed.data.folderId ?? null, parsed.data.name, user.id, objectKey]
    )
    if (!parsed.data.id) {
      // Only seed empty bytes for a genuinely new document — a retried
      // create for an existing id must not clobber content already saved.
      await writeAtKey(objectKey, new Uint8Array())
    }
    return c.json({ document: rows[0] }, 201)
  }
)

export const folderRoutes = new Hono()
folderRoutes.use('*', requireAuth)

const patchFolderSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
})

folderRoutes.patch('/:folderId', requireTeamRole('editor', teamIdForFolder), async (c) => {
  const parsed = patchFolderSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const { rows } = await pool.query(
    `update folders set
       name = coalesce($2, name),
       parent_folder_id = case when $3::text is not null then $3::uuid else parent_folder_id end
     where id = $1
     returning id, project_id, parent_folder_id, name, created_at`,
    [c.req.param('folderId'), parsed.data.name ?? null, parsed.data.parentFolderId ?? null]
  )
  if (!rows[0]) return c.json({ error: 'not found' }, 404)
  return c.json({ folder: rows[0] })
})

// Documents inside stay put (folder_id set to null via ON DELETE SET NULL) —
// deleting a folder never deletes documents.
folderRoutes.delete('/:folderId', requireTeamRole('editor', teamIdForFolder), async (c) => {
  await pool.query(`delete from folders where id = $1`, [c.req.param('folderId')])
  return c.json({ ok: true })
})
