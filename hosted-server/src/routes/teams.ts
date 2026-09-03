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
