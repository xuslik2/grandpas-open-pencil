import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { pool } from '../db/client.js'
import { hashToken, issueToken } from './token.js'

const COOKIE_NAME = 'session'
const SESSION_TTL_DAYS = 30

export type SessionUser = {
  id: string
  email: string
  displayName: string
  avatarColor: string
}

export async function createSession(c: Context, userId: string): Promise<void> {
  const [token, tokenHash] = issueToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)

  await pool.query(
    `insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  )

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, COOKIE_NAME)
  if (token) {
    await pool.query(`delete from sessions where token_hash = $1`, [hashToken(token)])
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}

export async function currentUser(c: Context): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE_NAME)
  if (!token) return null

  const { rows } = await pool.query(
    `select u.id, u.email, u.display_name, u.avatar_color
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.disabled_at is null`,
    [hashToken(token)]
  )
  const row = rows[0]
  if (!row) return null

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
  }
}
