// Resolves a project to attach documents to when they're saved via the
// generic StorageAdapter.putDocument path (OpenPencil's own "File > New" /
// autosave flow) rather than through the future dashboard's explicit
// "+ New file in project X" action. Lazily finds-or-creates a "Drafts"
// project in the user's first team. Once the dashboard (Phase 3) exists,
// most saves will already have a real project and never hit this path.

import { apiGet, apiJson } from './client'

type Team = { id: string; name: string; slug: string; role: string }
type Project = { id: string; name: string }

const DRAFTS_PROJECT_NAME = 'Drafts'

let cachedProjectId: Promise<string> | null = null

async function resolveDraftsProjectId(): Promise<string> {
  const { teams } = await apiGet<{ teams: Team[] }>('/teams')
  const team = teams[0]
  if (!team) {
    throw new Error('No team available — an account must belong to at least one team.')
  }

  const { projects } = await apiGet<{ projects: Project[] }>(`/teams/${team.id}/projects`)
  const existing = projects.find((p) => p.name === DRAFTS_PROJECT_NAME)
  if (existing) return existing.id

  const { project } = await apiJson<{ project: Project }>(
    'POST',
    `/teams/${team.id}/projects`,
    { name: DRAFTS_PROJECT_NAME }
  )
  return project.id
}

export function getDraftsProjectId(): Promise<string> {
  cachedProjectId ??= resolveDraftsProjectId().catch((err) => {
    cachedProjectId = null // allow retry on next call rather than caching a failure forever
    throw err
  })
  return cachedProjectId
}

// One-shot overrides: the dashboard's "+ New file in project X" registers
// the target project for a specific soon-to-exist document id here (see
// tabs/index.ts's createDocumentInProject), consumed the first time that
// id is actually saved. Falls back to Drafts for anything that never gets
// an explicit target — e.g. a plain new tab created outside the dashboard.
const pendingProjectByDocument = new Map<string, string>()

export function registerPendingProject(documentId: string, projectId: string): void {
  pendingProjectByDocument.set(documentId, projectId)
}

export function resolveTargetProjectId(documentId: string): Promise<string> {
  const pending = pendingProjectByDocument.get(documentId)
  if (pending) {
    pendingProjectByDocument.delete(documentId)
    return Promise.resolve(pending)
  }
  return getDraftsProjectId()
}
