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

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'team'
  )
}

const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
})

// Any authenticated user can create a team and becomes its owner — this
// deployment is invite-only at the account level already (no public
// signup), so a second gate here would just add friction for no real
// security benefit.
teamRoutes.post('/', async (c) => {
  const parsed = createTeamSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const user = c.get('user')
  const base = slugify(parsed.data.name)
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Retry with a numeric suffix on slug collision rather than failing
    // the whole request over a cosmetic uniqueness constraint.
    let slug = base
    let team: { id: string; name: string; slug: string } | null = null
    for (let attempt = 0; attempt < 20 && !team; attempt++) {
      slug = attempt === 0 ? base : `${base}-${attempt + 1}`
      const { rows } = await client.query(
        `insert into teams (name, slug) values ($1, $2)
         on conflict (slug) do nothing
         returning id, name, slug`,
        [parsed.data.name, slug]
      )
      team = rows[0] ?? null
    }
    if (!team) throw new Error('Could not allocate a unique team slug')

    await client.query(`insert into team_members (team_id, user_id, role) values ($1, $2, 'owner')`, [
      team.id,
      user.id,
    ])
    await client.query('commit')
    return c.json({ team: { ...team, role: 'owner' } }, 201)
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
})

// Members of a team, for the management UI. Any member can view the
// roster; only admins/owners get invite/remove/role-change actions
// (enforced on those routes below, not here).
teamRoutes.get('/:teamId/members', requireTeamRole('viewer', teamIdFromParam), async (c) => {
  const { rows } = await pool.query(
    `select u.id, u.email, u.display_name, u.avatar_color, m.role
       from team_members m
       join users u on u.id = m.user_id
      where m.team_id = $1
      order by u.display_name`,
    [c.req.param('teamId')]
  )
  return c.json({ members: rows })
})

const updateMemberRoleSchema = z.object({
  role: z.enum(['viewer', 'editor', 'admin', 'owner']),
})

async function ownerCount(teamId: string): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as n from team_members where team_id = $1 and role = 'owner'`,
    [teamId]
  )
  return rows[0].n
}

// Only owners can change roles (an admin promoting themselves to owner
// would otherwise be a privilege-escalation hole).
teamRoutes.patch(
  '/:teamId/members/:userId',
  requireTeamRole('owner', teamIdFromParam),
  async (c) => {
    const parsed = updateMemberRoleSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

    // Non-null: guaranteed present by the matched route pattern.
    const teamId = c.req.param('teamId')!
    const userId = c.req.param('userId')!

    // Don't allow demoting the last owner — that would strand the team
    // with nobody able to manage it.
    const { rows: current } = await pool.query(
      `select role from team_members where team_id = $1 and user_id = $2`,
      [teamId, userId]
    )
    if (!current[0]) return c.json({ error: 'not found' }, 404)
    if (current[0].role === 'owner' && parsed.data.role !== 'owner' && (await ownerCount(teamId)) <= 1) {
      return c.json({ error: 'Cannot demote the only owner' }, 400)
    }

    await pool.query(`update team_members set role = $1 where team_id = $2 and user_id = $3`, [
      parsed.data.role,
      teamId,
      userId,
    ])
    return c.json({ ok: true })
  }
)

teamRoutes.delete(
  '/:teamId/members/:userId',
  requireTeamRole('admin', teamIdFromParam),
  async (c) => {
    // Non-null: guaranteed present by the matched route pattern.
    const teamId = c.req.param('teamId')!
    const userId = c.req.param('userId')!

    const { rows: current } = await pool.query(
      `select role from team_members where team_id = $1 and user_id = $2`,
      [teamId, userId]
    )
    if (!current[0]) return c.json({ error: 'not found' }, 404)
    if (current[0].role === 'owner' && (await ownerCount(teamId)) <= 1) {
      return c.json({ error: 'Cannot remove the only owner' }, 400)
    }

    await pool.query(`delete from team_members where team_id = $1 and user_id = $2`, [
      teamId,
      userId,
    ])
    return c.json({ ok: true })
  }
)

// Pending (not yet accepted) invites, for the management UI to show
// "invited, waiting" alongside actual members.
teamRoutes.get('/:teamId/invites', requireTeamRole('admin', teamIdFromParam), async (c) => {
  const { rows } = await pool.query(
    `select id, email, role, created_at, expires_at
       from invites
      where team_id = $1 and accepted_at is null and expires_at > now()
      order by created_at desc`,
    [c.req.param('teamId')]
  )
  return c.json({ invites: rows })
})

teamRoutes.delete(
  '/:teamId/invites/:inviteId',
  requireTeamRole('admin', teamIdFromParam),
  async (c) => {
    await pool.query(`delete from invites where id = $1 and team_id = $2`, [
      c.req.param('inviteId'),
      c.req.param('teamId'),
    ])
    return c.json({ ok: true })
  }
)

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
// Ordered by the user-arranged `position` (sidebar drag-to-reorder) with
// name as a tiebreaker for projects that have never been reordered.
teamRoutes.get('/:teamId/projects', requireTeamRole('viewer', teamIdFromParam), async (c) => {
  const { rows } = await pool.query(
    `select p.id, p.name, p.position, p.created_by, p.created_at, p.archived_at,
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
      order by p.position, p.name`,
    [c.req.param('teamId')]
  )
  return c.json({ projects: rows })
})

teamRoutes.post('/:teamId/projects', requireTeamRole('editor', teamIdFromParam), async (c) => {
  const parsed = createProjectSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const user = c.get('user')
  // New projects go to the end of the arranged order, not position 0
  // (which would otherwise jump every new project to the front).
  const { rows } = await pool.query(
    `insert into projects (team_id, name, created_by, position)
     select $1, $2, $3, coalesce(max(position) + 1, 0) from projects where team_id = $1
     returning id, name, position, created_by, created_at, archived_at`,
    [c.req.param('teamId'), parsed.data.name, user.id]
  )
  return c.json({ project: rows[0] }, 201)
})

const reorderProjectsSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
})

// Sidebar drag-to-reorder: client sends the full new order, server assigns
// position = index. Only touches projects that actually belong to this
// team (silently ignores any id that doesn't — cheaper than 403ing on a
// stale client-side list).
teamRoutes.post(
  '/:teamId/projects/reorder',
  requireTeamRole('editor', teamIdFromParam),
  async (c) => {
    const parsed = reorderProjectsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

    const teamId = c.req.param('teamId')
    const client = await pool.connect()
    try {
      await client.query('begin')
      for (const [index, id] of parsed.data.orderedIds.entries()) {
        await client.query(
          `update projects set position = $1 where id = $2 and team_id = $3`,
          [index, id, teamId]
        )
      }
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
    return c.json({ ok: true })
  }
)
