<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, type ComponentPublicInstance } from 'vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { useFlatReorderDrag } from '@open-pencil/vue'
import type { Project, ProjectDocument } from '@/app/hosted/hierarchy/api'
import {
  createProject,
  createTeam,
  currentTeam,
  ensureFavoritesLoaded,
  ensureProjectsLoaded,
  favorites,
  moveDocumentToProject,
  projects,
  reorderProjectsLocally,
  setFavorited,
  switchTeam,
  teams
} from '@/app/hosted/hierarchy/store'
import { selectedProject } from '@/app/hosted/navigation/store'
import { openStorageDocumentInNewTab } from '@/app/tabs'
import { useMenuUI } from '@/components/ui/menu'
import TeamMembersDialog from '@/components/hosted/TeamMembersDialog.vue'

const creating = ref(false)
const newProjectName = ref('')
const creatingTeam = ref(false)
const newTeamName = ref('')
const openError = ref<string | null>(null)
const membersDialogOpen = ref(false)
const menuCls = useMenuUI({ content: 'min-w-48' })

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

async function pickTeam(team: (typeof teams.value)[number]) {
  selectedProject.value = null
  await switchTeam(team)
}

function startNewTeam() {
  selectedProject.value = null
  creatingTeam.value = true
}

async function submitNewTeam() {
  const name = newTeamName.value.trim()
  if (!name) return
  await createTeam(name)
  newTeamName.value = ''
  creatingTeam.value = false
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

// Separate, independent drop-target kind layered onto the same project
// rows: a document card dragged from ProjectDocuments.vue (dragKind:
// 'document') moves that file into this project. It coexists with the
// reorder drop-target above rather than replacing it — pragmatic-drag-
// and-drop supports multiple independent dropTargetForElements on one
// element, each filtering via its own canDrop. The reorder system's own
// canDrop is looser (any source lacking a matching `id`), so it may also
// "accept" a document drag and flash its before/after line, but its
// monitor bails out safely since a document drag carries no `id` field —
// see useFlatReorderDrag.ts's `sourceId` null-check.
const registeredDocumentDropTargets = new Map<string, () => void>()
const documentDropTargetId = ref<string | null>(null)

function setupProjectRowRef(value: Element | ComponentPublicInstance | null, project: Project) {
  const element = value instanceof HTMLElement ? value : null
  projectReorder.setupItem(element, () => ({ id: project.id }))

  registeredDocumentDropTargets.get(project.id)?.()
  registeredDocumentDropTargets.delete(project.id)
  if (!element) return

  const cleanup = dropTargetForElements({
    element,
    getData: () => ({ projectId: project.id }),
    canDrop: ({ source }) =>
      source.data.dragKind === 'document' && source.data.sourceProjectId !== project.id,
    onDragEnter: () => {
      documentDropTargetId.value = project.id
    },
    onDragLeave: () => {
      if (documentDropTargetId.value === project.id) documentDropTargetId.value = null
    },
    onDrop: ({ source }) => {
      documentDropTargetId.value = null
      const documentId = typeof source.data.documentId === 'string' ? source.data.documentId : null
      const sourceProjectId =
        typeof source.data.sourceProjectId === 'string' ? source.data.sourceProjectId : null
      if (!documentId || !sourceProjectId) return
      void moveDocumentToProject(documentId, sourceProjectId, project.id)
    }
  })
  registeredDocumentDropTargets.set(project.id, cleanup)
}

onScopeDispose(() => {
  for (const cleanup of registeredDocumentDropTargets.values()) cleanup()
  registeredDocumentDropTargets.clear()
})

const hasFavorites = computed(() => favorites.value.length > 0)
</script>

<template>
  <aside
    class="flex h-full w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-panel-secondary px-3 py-4"
  >
    <div class="flex items-center gap-1">
      <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-left text-sm font-semibold hover:bg-hover"
          >
            <span class="min-w-0 flex-1 truncate">{{ currentTeam?.name ?? 'Studio' }}</span>
            <icon-lucide-chevron-down class="size-3.5 shrink-0 text-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent side="bottom" align="start" :side-offset="4" :class="menuCls.content">
            <DropdownMenuItem
              v-for="team in teams"
              :key="team.id"
              :class="menuCls.item"
              @select="pickTeam(team)"
            >
              <span class="min-w-0 flex-1 truncate">{{ team.name }}</span>
              <icon-lucide-check v-if="currentTeam?.id === team.id" class="size-3 text-accent" />
            </DropdownMenuItem>
            <DropdownMenuSeparator class="my-1 h-px bg-border" />
            <DropdownMenuItem :class="menuCls.item" @select="startNewTeam">
              <icon-lucide-plus class="size-3.5" />
              <span>New team</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
      <button
        type="button"
        class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
        aria-label="Manage team members"
        @click="membersDialogOpen = true"
      >
        <icon-lucide-users class="size-3.5" />
      </button>
    </div>

    <form v-if="creatingTeam" class="flex items-center gap-1 px-1" @submit.prevent="submitNewTeam">
      <input
        v-model="newTeamName"
        type="text"
        autofocus
        placeholder="Team name"
        class="w-full min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs"
        @keydown.escape="creatingTeam = false"
      />
      <button
        type="submit"
        class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface disabled:pointer-events-none disabled:opacity-40"
        :disabled="!newTeamName.trim()"
        aria-label="Create team"
      >
        <icon-lucide-check class="size-3.5" />
      </button>
    </form>

    <p v-if="openError" class="px-1 text-xs text-danger" role="alert">{{ openError }}</p>

    <TeamMembersDialog v-model="membersDialogOpen" />

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

      <form
        v-if="creating"
        class="mt-1 flex items-center gap-1 px-1"
        @submit.prevent="submitNewProject"
      >
        <input
          v-model="newProjectName"
          type="text"
          autofocus
          placeholder="Project name"
          class="w-full min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-xs"
          @keydown.escape="creating = false"
        />
        <button
          type="submit"
          class="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface disabled:pointer-events-none disabled:opacity-40"
          :disabled="!newProjectName.trim()"
          aria-label="Create project"
        >
          <icon-lucide-check class="size-3.5" />
        </button>
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
              'opacity-40': projectReorder.draggingId.value === project.id,
              'ring-1 ring-inset ring-accent bg-hover': documentDropTargetId === project.id
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
