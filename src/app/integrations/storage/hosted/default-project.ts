// Resolves a project to attach documents to when they're saved via the
// generic StorageAdapter.putDocument path (OpenPencil's own "File > New" /
// autosave flow) rather than through the dashboard's explicit "+ New file
// in project X" action. Lazily finds-or-creates a "Drafts" project in
// whichever team is currently selected in the dashboard (app/hosted/
// hierarchy/store.ts) — not just "the first team", now that multiple
// teams are a real thing. Reaching into dashboard-navigation state from
// here is intentional, not a layering slip: a document with no explicit
// target should land in *whatever team the user is looking at*, and that
// state already lives there.

import { apiGet, apiJson } from './client'
import { currentTeam, ensureProjectsLoaded } from '@/app/hosted/hierarchy/store'

type Project = { id: string; name: string }

const DRAFTS_PROJECT_NAME = 'Drafts'

// Keyed by team id — switching teams must not reuse a cached Drafts
// project id from whichever team was current before.
const cachedProjectIdByTeam = new Map<string, Promise<string>>()

async function resolveDraftsProjectId(teamId: string): Promise<string> {
  const { projects } = await apiGet<{ projects: Project[] }>(`/teams/${teamId}/projects`)
  const existing = projects.find((p) => p.name === DRAFTS_PROJECT_NAME)
  if (existing) return existing.id

  const { project } = await apiJson<{ project: Project }>('POST', `/teams/${teamId}/projects`, {
    name: DRAFTS_PROJECT_NAME
  })
  return project.id
}

export async function getDraftsProjectId(): Promise<string> {
  await ensureProjectsLoaded()
  const team = currentTeam.value
  if (!team) {
    throw new Error('No team available — an account must belong to at least one team.')
  }

  let cached = cachedProjectIdByTeam.get(team.id)
  if (!cached) {
    cached = resolveDraftsProjectId(team.id).catch((err) => {
      cachedProjectIdByTeam.delete(team.id) // allow retry rather than caching a failure forever
      throw err
    })
    cachedProjectIdByTeam.set(team.id, cached)
  }
  return cached
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
