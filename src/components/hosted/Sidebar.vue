<script setup lang="ts">
import { computed, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useFlatReorderDrag } from '@open-pencil/vue'
import type { Project, ProjectDocument } from '@/app/hosted/hierarchy/api'
import {
  createProject,
  currentTeam,
  ensureFavoritesLoaded,
  ensureProjectsLoaded,
  favorites,
  projects,
  reorderProjectsLocally,
  setFavorited
} from '@/app/hosted/hierarchy/store'
import { selectedProject } from '@/app/hosted/navigation/store'
import { openStorageDocumentInNewTab } from '@/app/tabs'

const creating = ref(false)
const newProjectName = ref('')
const openError = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([ensureProjectsLoaded(), ensureFavoritesLoaded()])
})

async function submitNewProject() {
  const name = newProjectName.value.trim()
  if (!name) return
  await createProject(name)
  newProjectName.value = ''
  creating.value = false
}

async function openFavorite(doc: ProjectDocument) {
  openError.value = null
  try {
    await openStorageDocumentInNewTab({ id: doc.id, name: doc.name, updatedAt: doc.updated_at })
  } catch (err) {
    openError.value = err instanceof Error ? err.message : String(err)
  }
}

async function removeFavorite(doc: ProjectDocument) {
  await setFavorited(doc, false)
}

// Drag-to-reorder projects — same composable/pattern PagesPanel.vue uses
// for reordering document pages, applied to the sidebar's project list.
const projectReorder = useFlatReorderDrag<Project>({
  items: () => projects.value,
  onMove: (projectId, targetIndex) => {
    const current = [...projects.value]
    const fromIndex = current.findIndex((p) => p.id === projectId)
    if (fromIndex === -1) return
    const [moved] = current.splice(fromIndex, 1)
    current.splice(targetIndex, 0, moved)
    reorderProjectsLocally(current.map((p) => p.id))
  }
})

function dropPosition(project: Project): 'before' | 'after' | undefined {
  if (projectReorder.instructionTargetId.value !== project.id) return undefined
  const op = projectReorder.instruction.value?.operation
  if (op === 'reorder-before') return 'before'
  if (op === 'reorder-after') return 'after'
  return undefined
}

function setupProjectRowRef(value: Element | ComponentPublicInstance | null, project: Project) {
  projectReorder.setupItem(value instanceof HTMLElement ? value : null, () => ({
    id: project.id
  }))
}

const hasFavorites = computed(() => favorites.value.length > 0)
</script>

<template>
  <aside
    class="flex h-full w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-panel-secondary px-3 py-4"
  >
    <button
      type="button"
      class="truncate px-1 text-left text-sm font-semibold hover:text-accent"
      @click="selectedProject = null"
    >
      {{ currentTeam?.name ?? 'Studio' }}
    </button>

    <p v-if="openError" class="px-1 text-xs text-danger" role="alert">{{ openError }}</p>

    <section v-if="hasFavorites">
      <h3 class="px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Favorites</h3>
      <div class="mt-1 flex flex-col">
        <div
          v-for="doc in favorites"
          :key="doc.id"
          class="group flex items-center gap-1.5 rounded px-1 py-1 hover:bg-hover"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            @click="openFavorite(doc)"
          >
            <icon-lucide-star class="size-3 shrink-0 fill-current text-amber-400" />
            <span class="min-w-0 flex-1 truncate text-xs">{{ doc.name }}</span>
          </button>
          <button
            type="button"
            class="flex size-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:text-surface group-hover:opacity-100"
            aria-label="Remove from favorites"
            @click="removeFavorite(doc)"
          >
            <icon-lucide-x class="size-3" />
          </button>
        </div>
      </div>
    </section>

    <section class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-center gap-1 px-1">
        <h3 class="flex-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Projects
        </h3>
        <button
          type="button"
          class="flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
          aria-label="New project"
          @click="creating = true"
        >
          <icon-lucide-plus class="size-3.5" />
        </button>
      </div>

      <form v-if="creating" class="mt-1 px-1" @submit.prevent="submitNewProject">
        <input
          v-model="newProjectName"
          type="text"
          autofocus
          placeholder="Project name"
          class="w-full rounded border border-border bg-input px-2 py-1 text-xs"
          @keydown.escape="creating = false"
          @blur="creating = false"
        />
      </form>

      <div class="mt-1 flex flex-col">
        <div
          v-for="project in projects"
          :key="project.id"
          :ref="(value) => setupProjectRowRef(value, project)"
          class="relative"
          :data-dragging="projectReorder.draggingId.value === project.id || undefined"
        >
          <div v-if="dropPosition(project) === 'before'" class="h-0.5 rounded bg-accent" />
          <button
            type="button"
            class="flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left text-xs hover:bg-hover"
            :class="{
              'bg-hover font-medium': selectedProject?.id === project.id,
              'opacity-40': projectReorder.draggingId.value === project.id
            }"
            @click="selectedProject = project"
          >
            <icon-lucide-folder class="size-3.5 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate">{{ project.name }}</span>
          </button>
          <div v-if="dropPosition(project) === 'after'" class="h-0.5 rounded bg-accent" />
        </div>
        <p v-if="projects.length === 0 && !creating" class="px-1 py-1 text-xs text-muted">
          No projects yet.
        </p>
      </div>
    </section>
  </aside>
</template>
