import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db/client.js'
import { issueToken } from '../auth/token.js'
import { requireAuth, requireTeamRole, teamIdFromParam } from '../middleware/authz.js'

export const teamRoutes = new Hono()

teamRoutes.use('*', requireAuth)

// Teams the current user belongs to, with their role on each.
teamRoutes.get('/', async (c) => {
  const user = c.get('user')
  const { rows } = await pool.query(
    `select t.id, t.name, t.slug, m.role
       from teams t join team_members m on m.team_id = t.id
      where m.user_id = $1
      order by t.name`,
    [user.id]
  )
  return c.json({ teams: rows })
})

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['viewer', 'editor', 'admin']),
})

const INVITE_TTL_DAYS = 14

// Only team admins/owners can invite.
teamRoutes.post('/:teamId/invites', requireTeamRole('admin', teamIdFromParam), async (c) => {
  const parsed = createInviteSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const user = c.get('user')
  const teamId = c.req.param('teamId')
  const [token, tokenHash] = issueToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  await pool.query(
    `insert into invites (email, team_id, role, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [parsed.data.email, teamId, parsed.data.role, tokenHash, user.id, expiresAt]
  )

  // No SMTP wired yet (Phase 1 MVP) — the admin shares this link manually.
  return c.json({ inviteUrl: `/invite/${token}` })
})

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
})

// Any team member can see projects; creating one requires editor+.
// Includes each project's most-recently-updated document (for the
// dashboard's card thumbnail) via a lateral join rather than N+1 queries.
teamRoutes.get('/:teamId/projects', requireTeamRole('viewer', teamIdFromParam), async (c) => {
  const { rows } = await pool.query(
    `select p.id, p.name, p.created_by, p.created_at, p.archived_at,
            d.id as latest_document_id, d.updated_at as latest_document_updated_at,
            (d.thumb_object_key is not null) as latest_document_has_thumbnail
       from projects p
       left join lateral (
         select id, updated_at, thumb_object_key
           from documents
          where project_id = p.id and deleted_at is null
          order by updated_at desc
          limit 1
       ) d on true
      where p.team_id = $1 and p.archived_at is null
      order by p.name`,
    [c.req.param('teamId')]
  )
  return c.json({ projects: rows })
})

teamRoutes.post('/:teamId/projects', requireTeamRole('editor', teamIdFromParam), async (c) => {
  const parsed = createProjectSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const user = c.get('user')
  const { rows } = await pool.query(
    `insert into projects (team_id, name, created_by) values ($1, $2, $3)
     returning id, name, created_by, created_at, archived_at`,
    [c.req.param('teamId'), parsed.data.name, user.id]
  )
  return c.json({ project: rows[0] }, 201)
})
