import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

const schemaPath = fileURLToPath(new URL('../../db/schema.sql', import.meta.url))

/**
 * Additive changes applied to databases that already have the base
 * schema. schema.sql only ever runs on a brand-new database, so anything
 * added to it after the first deploy has to appear here too. Each
 * statement must be idempotent — this runs on every boot.
 */
const migrations: Array<{ name: string; sql: string }> = [
  {
    name: 'assets',
    sql: `create table if not exists assets (
            team_id uuid not null references teams(id) on delete cascade,
            hash text not null,
            size_bytes bigint not null,
            created_at timestamptz not null default now(),
            primary key (team_id, hash)
          )`,
  },
]

async function main() {
  const { rows } = await pool.query(
    `select 1 from information_schema.tables where table_name = 'users'`
  )

  if (rows.length === 0) {
    await pool.query(readFileSync(schemaPath, 'utf8'))
    console.log('schema applied')
  } else {
    console.log('base schema already applied')
  }

  for (const migration of migrations) {
    await pool.query(migration.sql)
    console.log(`migration ok: ${migration.name}`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
