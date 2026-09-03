// Teams/projects/documents hierarchy client. Reuses the same fetch
// conventions as integrations/storage/hosted/client.ts, but lives here
// because it's dashboard-navigation data, not part of the StorageAdapter
// contract (see HOSTED.md's "storage-adapter scoping decision").

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

export type TeamRole = 'viewer' | 'editor' | 'admin' | 'owner'
export type Team = { id: string; name: string; slug: string; role: TeamRole }

export type Member = {
  id: string
  email: string
  display_name: string
  avatar_color: string
  role: TeamRole
}

export type PendingInvite = {
  id: string
  email: string
  role: TeamRole
  created_at: string
  expires_at: string
}

export type Project = {
  id: string
  name: string
  position: number
  created_at: string
  latest_document_id: string | null
  latest_document_updated_at: string | null
  latest_document_has_thumbnail: boolean
}

export type ProjectDocument = {
  id: string
  name: string
  updated_at: string
  folder_id: string | null
  has_thumbnail: boolean
}

export function listTeams(): Promise<Team[]> {
  return request<{ teams: Team[] }>('/teams').then((r) => r.teams)
}

export function createTeam(name: string): Promise<Team> {
  return request<{ team: Team }>('/teams', {
    method: 'POST',
    body: JSON.stringify({ name })
  }).then((r) => r.team)
}

export function listMembers(teamId: string): Promise<Member[]> {
  return request<{ members: Member[] }>(`/teams/${teamId}/members`).then((r) => r.members)
}

export function updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<void> {
  return request(`/teams/${teamId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role })
  })
}

export function removeMember(teamId: string, userId: string): Promise<void> {
  return request(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' })
}

export function listPendingInvites(teamId: string): Promise<PendingInvite[]> {
  return request<{ invites: PendingInvite[] }>(`/teams/${teamId}/invites`).then((r) => r.invites)
}

export function createInvite(
  teamId: string,
  email: string,
  role: TeamRole
): Promise<{ inviteUrl: string }> {
  return request(`/teams/${teamId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email, role })
  })
}

export function revokeInvite(teamId: string, inviteId: string): Promise<void> {
  return request(`/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' })
}

export function listProjects(teamId: string): Promise<Project[]> {
  return request<{ projects: Project[] }>(`/teams/${teamId}/projects`).then((r) => r.projects)
}

export function createProject(teamId: string, name: string): Promise<Project> {
  return request<{ project: Project }>(`/teams/${teamId}/projects`, {
    method: 'POST',
    body: JSON.stringify({ name })
  }).then((r) => r.project)
}

export function reorderProjects(teamId: string, orderedIds: string[]): Promise<void> {
  return request(`/teams/${teamId}/projects/reorder`, {
    method: 'POST',
    body: JSON.stringify({ orderedIds })
  })
}

export function listProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  return request<{ documents: ProjectDocument[] }>(`/projects/${projectId}/documents`).then(
    (r) => r.documents
  )
}

export function createProjectDocument(projectId: string, name: string): Promise<ProjectDocument> {
  return request<{ document: ProjectDocument }>(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: JSON.stringify({ name })
  }).then((r) => r.document)
}

export function listFavoriteDocuments(): Promise<ProjectDocument[]> {
  return request<{ documents: ProjectDocument[] }>('/documents/favorites').then(
    (r) => r.documents
  )
}

export function moveDocument(documentId: string, projectId: string): Promise<void> {
  return request(`/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ projectId })
  })
}

export function favoriteDocument(id: string): Promise<void> {
  return request(`/documents/${id}/favorite`, { method: 'POST' })
}

export function unfavoriteDocument(id: string): Promise<void> {
  return request(`/documents/${id}/favorite`, { method: 'DELETE' })
}
