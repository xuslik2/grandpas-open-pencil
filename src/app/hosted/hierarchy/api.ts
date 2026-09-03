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

export type Team = { id: string; name: string; slug: string; role: string }

export type Project = {
  id: string
  name: string
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

export function listProjects(teamId: string): Promise<Project[]> {
  return request<{ projects: Project[] }>(`/teams/${teamId}/projects`).then((r) => r.projects)
}

export function createProject(teamId: string, name: string): Promise<Project> {
  return request<{ project: Project }>(`/teams/${teamId}/projects`, {
    method: 'POST',
    body: JSON.stringify({ name })
  }).then((r) => r.project)
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

export function favoriteDocument(id: string): Promise<void> {
  return request(`/documents/${id}/favorite`, { method: 'POST' })
}

export function unfavoriteDocument(id: string): Promise<void> {
  return request(`/documents/${id}/favorite`, { method: 'DELETE' })
}
