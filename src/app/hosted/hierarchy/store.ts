// Shared reactive project list so the sidebar (compact, draggable) and the
// main-area grid (cards with thumbnails) — both showing "the team's
// projects" — stay in sync without each fetching and holding its own
// separate copy. Creating a project or dragging to reorder in one updates
// what the other renders immediately.

import { ref } from 'vue'
import {
  createProject as apiCreateProject,
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

export const currentTeam = ref<Team | null>(null)
export const projects = ref<Project[]>([])
export const favorites = ref<ProjectDocument[]>([])

let loaded = false

export async function ensureProjectsLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  const teams = await listTeams()
  currentTeam.value = teams[0] ?? null
  if (currentTeam.value) {
    projects.value = await listProjects(currentTeam.value.id)
  }
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
