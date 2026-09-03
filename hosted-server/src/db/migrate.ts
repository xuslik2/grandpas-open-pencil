import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pool } from './client.js'

const schemaPath = fileURLToPath(new URL('../../db/schema.sql', import.meta.url))

async function main() {
  const { rows } = await pool.query(
    `select 1 from information_schema.tables where table_name = 'users'`
  )
  if (rows.length > 0) {
    console.log('schema already applied, skipping')
    await pool.end()
    return
  }

  const sql = readFileSync(schemaPath, 'utf8')
  await pool.query(sql)
  console.log('schema applied')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
