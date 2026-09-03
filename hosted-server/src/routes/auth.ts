import { Hono } from 'hono'
import { z } from 'zod'
import { pool } from '../db/client.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { createSession, currentUser, destroySession } from '../auth/session.js'
import { hashToken } from '../auth/token.js'

export const authRoutes = new Hono()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRoutes.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const { rows } = await pool.query(
    `select id, password_hash from users where email = $1 and disabled_at is null`,
    [parsed.data.email]
  )
  const row = rows[0]
  // Constant-shape response whether or not the email exists, to avoid
  // leaking which emails have accounts.
  const ok = row ? await verifyPassword(parsed.data.password, row.password_hash) : false
  if (!ok) return c.json({ error: 'invalid credentials' }, 401)

  await createSession(c, row.id)
  return c.json({ ok: true })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(c)
  return c.json({ ok: true })
})

authRoutes.get('/me', async (c) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  return c.json({ user })
})

// Invite creation lives in routes/teams.ts (POST /api/teams/:teamId/invites) —
// it's team-scoped and admin-gated, so it belongs with the other team routes.
// This file only handles the unauthenticated invite-acceptance flow below.

authRoutes.get('/invites/:token', async (c) => {
  const { rows } = await pool.query(
    `select i.email, i.role, t.name as team_name
       from invites i join teams t on t.id = i.team_id
      where i.token_hash = $1 and i.expires_at > now() and i.accepted_at is null`,
    [hashToken(c.req.param('token'))]
  )
  const row = rows[0]
  if (!row) return c.json({ error: 'invalid or expired invite' }, 404)
  return c.json({ email: row.email, role: row.role, teamName: row.team_name })
})

const acceptInviteSchema = z.object({
  displayName: z.string().min(1).max(80),
  password: z.string().min(8),
})

authRoutes.post('/invites/:token/accept', async (c) => {
  const parsed = acceptInviteSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'invalid request' }, 400)

  const tokenHash = hashToken(c.req.param('token'))
  const client = await pool.connect()
  try {
    await client.query('begin')

    const { rows: inviteRows } = await client.query(
      `select id, email, team_id, role from invites
        where token_hash = $1 and expires_at > now() and accepted_at is null
        for update`,
      [tokenHash]
    )
    const invite = inviteRows[0]
    if (!invite) {
      await client.query('rollback')
      return c.json({ error: 'invalid or expired invite' }, 404)
    }

    const passwordHash = await hashPassword(parsed.data.password)

    // Reuse an existing account (e.g. invited to a second team) or create one.
    const { rows: existingUser } = await client.query(`select id from users where email = $1`, [
      invite.email,
    ])
    let userId = existingUser[0]?.id
    if (!userId) {
      const { rows: newUser } = await client.query(
        `insert into users (email, password_hash, display_name) values ($1, $2, $3) returning id`,
        [invite.email, passwordHash, parsed.data.displayName]
      )
      userId = newUser[0].id
    }

    await client.query(
      `insert into team_members (team_id, user_id, role) values ($1, $2, $3)
       on conflict (team_id, user_id) do update set role = excluded.role`,
      [invite.team_id, userId, invite.role]
    )
    await client.query(`update invites set accepted_at = now() where id = $1`, [invite.id])

    await client.query('commit')

    await createSession(c, userId)
    return c.json({ ok: true })
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
})
