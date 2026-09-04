// Thin fetch wrapper for hosted-server's REST API. Same-origin (/api/*,
// proxied by Caddy) — cookies ride along automatically, no credentials to
// configure, which is why this adapter's preferenceFields/credentialFields
// are both empty in providers.ts.

export class HostedApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function parseError(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({ error: res.statusText }))
  throw new HostedApiError(body.error ?? 'Request failed', res.status)
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'include' })
  if (!res.ok) return parseError(res)
  return res.json() as Promise<T>
}

export async function apiGetOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`/api${path}`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) return parseError(res)
  return res.json() as Promise<T>
}

export async function apiJson<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (!res.ok) return parseError(res)
  return res.json() as Promise<T>
}

export async function apiGetBytes(path: string): Promise<Uint8Array | null> {
  const res = await fetch(`/api${path}`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) return parseError(res)
  return new Uint8Array(await res.arrayBuffer())
}

// Returns the response body as a Blob — never materialised on the JS
// heap, unlike arrayBuffer(). For a large document that difference is a
// full document-size allocation that nothing ever needed.
export async function apiGetBlob(path: string): Promise<Blob | null> {
  const res = await fetch(`/api${path}`, { credentials: 'include' })
  if (res.status === 404) return null
  if (!res.ok) return parseError(res)
  return res.blob()
}

export async function apiPutBytes(path: string, bytes: Uint8Array): Promise<Response> {
  return fetch(`/api${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes
  })
}
