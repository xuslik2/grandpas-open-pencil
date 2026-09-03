<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ensureProjectsLoaded, projects } from '@/app/hosted/hierarchy/store'
import { selectedProject } from '@/app/hosted/navigation/store'

// Project list itself is shared state (app/hosted/hierarchy/store.ts) with
// the sidebar, which owns creation/reordering — this is just the card
// grid view of the same data, so creating or dragging a project in the
// sidebar shows up here immediately without a separate fetch.
const loading = ref(true)

onMounted(async () => {
  await ensureProjectsLoaded()
  loading.value = false
})

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
</script>

<template>
  <section class="mt-2">
    <h2 class="mb-3 text-base font-semibold">Projects</h2>

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
      No projects yet — use "+" in the sidebar to create one.
    </div>
  </section>
</template>
