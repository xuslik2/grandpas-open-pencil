import { Hono } from 'hono'
import { pool } from '../db/client.js'
import { requireAuth } from '../middleware/authz.js'

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
