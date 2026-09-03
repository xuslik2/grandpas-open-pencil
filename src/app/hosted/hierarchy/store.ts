// Shared reactive team/project state so the sidebar (compact, draggable),
// the main-area grid (cards with thumbnails), and the team switcher all
// stay in sync without each fetching and holding its own separate copy.
// Creating a project, switching teams, or dragging to reorder in one
// place updates what everything else renders immediately.

import { useLocalStorage } from '@vueuse/core'
import { ref } from 'vue'
import {
  createProject as apiCreateProject,
  createTeam as apiCreateTeam,
  favoriteDocument as apiFavoriteDocument,
  listFavoriteDocuments,
  listProjects,
  listTeams,
  moveDocument as apiMoveDocument,
  reorderProjects as apiReorderProjects,
  unfavoriteDocument as apiUnfavoriteDocument,
  type Project,
  type ProjectDocument,
  type Team
} from './api'

export const teams = ref<Team[]>([])
export const currentTeam = ref<Team | null>(null)
export const projects = ref<Project[]>([])
export const favorites = ref<ProjectDocument[]>([])

// Remembers which team you were last looking at, per browser — a fresh
// visit still defaults to the first team if this is empty or stale.
const lastTeamId = useLocalStorage<string>('open-pencil:hosted:current-team-id', '')

let loaded = false

export async function ensureProjectsLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  teams.value = await listTeams()
  const remembered = teams.value.find((t) => t.id === lastTeamId.value)
  await switchTeam(remembered ?? teams.value[0] ?? null)
}

export async function switchTeam(team: Team | null): Promise<void> {
  currentTeam.value = team
  lastTeamId.value = team?.id ?? ''
  projects.value = team ? await listProjects(team.id) : []
}

export const refreshing = ref(false)
// Bumped on each manual refresh. Views holding their own document lists
// (the open project's file grid) watch this, since a refresh doesn't
// change the selected project's id and so wouldn't otherwise re-fetch.
export const workspaceRefreshToken = ref(0)

/**
 * Re-fetches teams, the current team's projects, and favorites — for the
 * dashboard's refresh control. Unlike ensureProjectsLoaded this ignores
 * the already-loaded guard, so it picks up work done elsewhere (another
 * device, a teammate, or a document that finished saving in another tab).
 */
export async function refreshWorkspace(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    teams.value = await listTeams()
    const current = teams.value.find((t) => t.id === currentTeam.value?.id)
    const remembered = teams.value.find((t) => t.id === lastTeamId.value)
    await switchTeam(current ?? remembered ?? teams.value[0] ?? null)
    favorites.value = await listFavoriteDocuments()
    favoritesLoaded = true
    loaded = true
    workspaceRefreshToken.value++
  } finally {
    refreshing.value = false
  }
}

export async function createTeam(name: string): Promise<Team> {
  const team = await apiCreateTeam(name)
  teams.value = [...teams.value, team]
  await switchTeam(team)
  return team
}

let favoritesLoaded = false

export async function ensureFavoritesLoaded(): Promise<void> {
  if (favoritesLoaded) return
  favoritesLoaded = true
  favorites.value = await listFavoriteDocuments()
}

export async function setFavorited(doc: ProjectDocument, favorited: boolean): Promise<void> {
  const previous = favorites.value
  favorites.value = favorited
    ? [...previous.filter((d) => d.id !== doc.id), doc]
    : previous.filter((d) => d.id !== doc.id)
  try {
    await (favorited ? apiFavoriteDocument(doc.id) : apiUnfavoriteDocument(doc.id))
  } catch (err) {
    favorites.value = previous // resync on failure rather than trust the optimistic flip
    throw err
  }
}

export async function createProject(name: string): Promise<Project> {
  if (!currentTeam.value) throw new Error('No team available')
  const project = await apiCreateProject(currentTeam.value.id, name)
  projects.value = [...projects.value, project]
  return project
}

export function reorderProjectsLocally(orderedIds: string[]): void {
  const byId = new Map(projects.value.map((p) => [p.id, p]))
  projects.value = orderedIds.map((id) => byId.get(id)).filter((p): p is Project => !!p)
  if (currentTeam.value) void apiReorderProjects(currentTeam.value.id, orderedIds)
}

// Fires after a document is dragged from a project's file grid onto a
// different project in the sidebar. ProjectDocuments.vue watches this to
// drop the moved file from its currently-open project's list — the two
// components don't otherwise share document-list state.
export const lastDocumentMove = ref<{
  documentId: string
  fromProjectId: string
  toProjectId: string
} | null>(null)

export async function moveDocumentToProject(
  documentId: string,
  fromProjectId: string,
  toProjectId: string
): Promise<void> {
  if (fromProjectId === toProjectId) return
  await apiMoveDocument(documentId, toProjectId)
  lastDocumentMove.value = { documentId, fromProjectId, toProjectId }
}
