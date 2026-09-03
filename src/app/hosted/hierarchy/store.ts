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
