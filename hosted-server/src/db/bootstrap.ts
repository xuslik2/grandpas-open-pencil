// Creates the first owner account + team from env vars. Idempotent — does
// nothing if any user already exists. Invite-only means there is no other
// way to create the very first account.
import { pool } from './client.js'
import { hashPassword } from '../auth/password.js'

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
  const teamName = process.env.BOOTSTRAP_TEAM_NAME ?? "Grandpa's Studio"

  if (!email || !password) {
    console.log('BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set, skipping bootstrap')
    await pool.end()
    return
  }

  const { rows: existing } = await pool.query(`select 1 from users limit 1`)
  if (existing.length > 0) {
    console.log('users already exist, skipping bootstrap')
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('begin')

    const passwordHash = await hashPassword(password)
    const { rows: userRows } = await client.query(
      `insert into users (email, password_hash, display_name) values ($1, $2, $3) returning id`,
      [email, passwordHash, email.split('@')[0]]
    )
    const userId = userRows[0].id

    const slug = teamName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    const { rows: teamRows } = await client.query(
      `insert into teams (name, slug) values ($1, $2) returning id`,
      [teamName, slug]
    )
    const teamId = teamRows[0].id

    await client.query(
      `insert into team_members (team_id, user_id, role) values ($1, $2, 'owner')`,
      [teamId, userId]
    )

    await client.query('commit')
    console.log(`bootstrapped owner ${email} on team "${teamName}"`)
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
