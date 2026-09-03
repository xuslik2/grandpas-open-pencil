import { createHash, randomBytes } from 'node:crypto'

/** Returns [plaintext token to hand to the client, sha256 hex hash to store in the DB]. */
export function issueToken(): [string, string] {
  const token = randomBytes(32).toString('base64url')
  return [token, hashToken(token)]
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
