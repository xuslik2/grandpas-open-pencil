import type { Context, Next } from 'hono'
import { pool } from '../db/client.js'
import { currentUser, type SessionUser } from '../auth/session.js'

const ROLE_RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 } as const
export type TeamRole = keyof typeof ROLE_RANK

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser
    teamRole: TeamRole
  }
}

export function hasAtLeastRole(actual: TeamRole, min: TeamRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min]
}

/** 401s unless a valid session cookie is present. Sets c.var.user. */
export async function requireAuth(c: Context, next: Next) {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user)
  await next()
}

async function roleForTeam(userId: string, teamId: string): Promise<TeamRole | null> {
  const { rows } = await pool.query(
    `select role from team_members where team_id = $1 and user_id = $2`,
    [teamId, userId]
  )
  return rows[0]?.role ?? null
}

/**
 * 403s unless the authenticated user has at least `min` role on the team
 * identified by the given resolver. Must run after requireAuth.
 */
export function requireTeamRole(min: TeamRole, resolveTeamId: (c: Context) => Promise<string | null>) {
  return async (c: Context, next: Next) => {
    const user = c.get('user')
    const teamId = await resolveTeamId(c)
    if (!teamId) return c.json({ error: 'not found' }, 404)

    const role = await roleForTeam(user.id, teamId)
    if (!role || !hasAtLeastRole(role, min)) {
      return c.json({ error: 'forbidden' }, 403)
    }
    c.set('teamRole', role)
    await next()
  }
}

// Resolvers for nested resources — each walks up to the owning team_id.
export async function teamIdFromParam(c: Context): Promise<string | null> {
  return c.req.param('teamId') ?? null
}

export async function teamIdForProject(c: Context): Promise<string | null> {
  const { rows } = await pool.query(`select team_id from projects where id = $1`, [
    c.req.param('projectId'),
  ])
  return rows[0]?.team_id ?? null
}

export async function teamIdForFolder(c: Context): Promise<string | null> {
  const { rows } = await pool.query(
    `select p.team_id from folders f join projects p on p.id = f.project_id where f.id = $1`,
    [c.req.param('folderId')]
  )
  return rows[0]?.team_id ?? null
}

export async function teamIdForDocument(c: Context): Promise<string | null> {
  const { rows } = await pool.query(
    `select p.team_id from documents d join projects p on p.id = d.project_id where d.id = $1`,
    [c.req.param('documentId')]
  )
  return rows[0]?.team_id ?? null
}
