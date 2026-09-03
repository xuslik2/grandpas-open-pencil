<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  createProject,
  listProjects,
  listTeams,
  type Project,
  type Team
} from '@/app/hosted/hierarchy/api'
import { selectedProject } from '@/app/hosted/navigation/store'

const team = ref<Team | null>(null)
const projects = ref<Project[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const creating = ref(false)
const newProjectName = ref('')

async function load() {
  loading.value = true
  error.value = null
  try {
    const teams = await listTeams()
    team.value = teams[0] ?? null
    if (team.value) projects.value = await listProjects(team.value.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function submitNewProject() {
  const name = newProjectName.value.trim()
  if (!name || !team.value) return
  try {
    const project = await createProject(team.value.id, name)
    projects.value = [...projects.value, project].sort((a, b) => a.name.localeCompare(b.name))
    newProjectName.value = ''
    creating.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

onMounted(load)
defineExpose({ reload: load })
</script>

<template>
  <section class="mt-7">
    <div class="mb-3 flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold">{{ team?.name ?? 'Projects' }}</h2>
        <p class="mt-0.5 text-xs text-muted">Projects</p>
      </div>
      <button
        v-if="!creating"
        type="button"
        class="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-hover"
        @click="creating = true"
      >
        <icon-lucide-plus class="size-3.5" />
        New project
      </button>
      <form v-else class="flex items-center gap-1.5" @submit.prevent="submitNewProject">
        <input
          v-model="newProjectName"
          type="text"
          autofocus
          placeholder="Project name"
          class="w-40 rounded border border-border bg-input px-2 py-1.5 text-xs"
          @keydown.escape="creating = false"
        />
        <button
          type="submit"
          class="rounded bg-accent px-2.5 py-1.5 text-xs text-white"
          :disabled="!newProjectName.trim()"
        >
          Create
        </button>
      </form>
    </div>

    <p v-if="error" class="mb-3 text-xs text-danger" role="alert">{{ error }}</p>

    <div
      v-if="loading"
      class="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
    >
      <div v-for="i in 3" :key="i" class="min-w-0 animate-pulse">
        <div class="aspect-video rounded-lg border border-border bg-panel-field" />
        <div class="mt-2 h-3 w-2/3 rounded bg-panel-field" />
      </div>
    </div>

    <div
      v-else-if="projects.length"
      class="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
    >
      <button
        v-for="project in projects"
        :key="project.id"
        type="button"
        class="group min-w-0 text-left"
        @click="selectedProject = project"
      >
        <div
          class="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-border bg-panel-field transition-colors group-hover:border-panel-focus"
        >
          <img
            v-if="project.latest_document_has_thumbnail"
            :src="`/api/documents/${project.latest_document_id}/thumbnail`"
            alt=""
            class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
          />
          <icon-lucide-folder v-else class="size-8 text-muted/40" />
        </div>
        <p class="mt-2 truncate text-xs font-medium">{{ project.name }}</p>
        <p class="mt-0.5 truncate text-[10px] text-muted">
          {{
            project.latest_document_updated_at
              ? `Edited ${relativeTime(project.latest_document_updated_at)}`
              : 'No files yet'
          }}
        </p>
      </button>
    </div>

    <div
      v-else
      class="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted sm:py-6"
    >
      No projects yet — create one to get started.
    </div>
  </section>
</template>
