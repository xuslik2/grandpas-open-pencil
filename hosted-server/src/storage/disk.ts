import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const DATA_DIR = process.env.DATA_DIR ?? '/data/hosted'

export function documentObjectKey(projectId: string, documentId: string): string {
  return join('documents', projectId, `${documentId}.fig`)
}

export function thumbnailObjectKey(documentId: string): string {
  return join('thumbnails', `${documentId}.jpg`)
}

// Content-addressed, so the same image embedded in twenty documents is
// stored once. Callers validate the hash shape before this point; the
// basename check is a second line against a traversal via the URL param.
export function assetObjectKey(teamId: string, hash: string): string {
  if (hash.includes('/') || hash.includes('..')) throw new Error('invalid asset hash')
  return join('assets', teamId, hash)
}

function absolutePath(key: string): string {
  return join(DATA_DIR, key)
}

export async function writeAtKey(key: string, bytes: Uint8Array): Promise<void> {
  const path = absolutePath(key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

export async function readAtKey(key: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath(key))
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

export async function deleteAtKey(key: string): Promise<void> {
  try {
    await unlink(absolutePath(key))
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }
}
