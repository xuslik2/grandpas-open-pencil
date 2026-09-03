// Client for hosted-server's auth API. Same-origin (/api/*, proxied by
// Caddy to the backend) — see HOSTED.md for why.

export type HostedUser = {
  id: string
  email: string
  displayName: string
  avatarColor: string
}

class HostedApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new HostedApiError(body.error ?? 'Request failed', res.status)
  }
  return res.json() as Promise<T>
}

export function login(email: string, password: string): Promise<{ ok: true }> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function logout(): Promise<{ ok: true }> {
  return request('/auth/logout', { method: 'POST' })
}

export async function fetchCurrentUser(): Promise<HostedUser | null> {
  try {
    const { user } = await request<{ user: HostedUser }>('/auth/me')
    return user
  } catch (err) {
    if (err instanceof HostedApiError && err.status === 401) return null
    throw err
  }
}

export function fetchInvite(
  token: string
): Promise<{ email: string; role: string; teamName: string }> {
  return request(`/auth/invites/${token}`)
}

export function acceptInvite(
  token: string,
  displayName: string,
  password: string
): Promise<{ ok: true }> {
  return request(`/auth/invites/${token}/accept`, {
    method: 'POST',
    body: JSON.stringify({ displayName, password })
  })
}

export { HostedApiError }
