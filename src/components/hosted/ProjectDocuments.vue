<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDocumentWorkspace } from '@open-pencil/vue'
import { listProjectDocuments } from '@/app/hosted/hierarchy/api'
import { ensureFavoritesLoaded, favorites, setFavorited } from '@/app/hosted/hierarchy/store'
import { selectedProject } from '@/app/hosted/navigation/store'
import { createDocumentInProject, openStorageDocumentInNewTab } from '@/app/tabs'

const openError = ref<string | null>(null)

void ensureFavoritesLoaded()

// Shared with the sidebar (app/hosted/hierarchy/store.ts) so starring a
// file here updates the sidebar's Favorites list immediately, and vice
// versa — same fix as the earlier project-list sync gap.
const favoritedIds = computed(() => new Set(favorites.value.map((d) => d.id)))

async function toggleFavorite(document: { id: string; name: string; updatedAt: string }) {
  await setFavorited(
    { id: document.id, name: document.name, updated_at: document.updatedAt, folder_id: null, has_thumbnail: false },
    !favoritedIds.value.has(document.id)
  )
}

const workspace = useDocumentWorkspace<{ id: string; name: string; updatedAt: string }>({
  source: {
    async refresh() {
      if (!selectedProject.value) return []
      const docs = await listProjectDocuments(selectedProject.value.id)
      return docs.map((d) => ({ id: d.id, name: d.name, updatedAt: d.updated_at }))
    },
    async loadPreview(id) {
      const res = await fetch(`/api/documents/${id}/thumbnail`, { credentials: 'include' })
      if (!res.ok) return null
      return new Uint8Array(await res.arrayBuffer())
    }
  },
  refreshOnFocus: false,
  refreshOnReconnect: false,
  previewConcurrency: 6
})

const documents = workspace.documents
const previewURL = workspace.previewURL
const vWorkspacePreview = workspace.previewDirective

async function openDocument(id: string, name: string, updatedAt: string) {
  openError.value = null
  try {
    await openStorageDocumentInNewTab({ id, name, updatedAt })
  } catch (err) {
    openError.value = err instanceof Error ? err.message : String(err)
  }
}

function newDocument() {
  if (!selectedProject.value) return
  openError.value = null
  // Opens a genuinely valid new local document (same path a plain new tab
  // takes), just targeted at this project instead of the Drafts fallback —
  // see tabs/index.ts's createDocumentInProject for why this replaced an
  // earlier approach that pre-created an empty row server-side (empty
  // bytes aren't a valid .fig/zip container, so it failed to open).
  createDocumentInProject(selectedProject.value.id)
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

const hasDocuments = computed(() => documents.value.length > 0)

void workspace.refresh()
</script>

<template>
  <section class="mt-2">
    <div class="mb-3 flex items-center gap-3">
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
        aria-label="Back to projects"
        @click="selectedProject = null"
      >
        <icon-lucide-arrow-left class="size-4" />
      </button>
      <h2 class="min-w-0 flex-1 truncate text-base font-semibold">{{ selectedProject?.name }}</h2>
      <button
        type="button"
        class="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs hover:bg-hover"
        @click="newDocument"
      >
        <icon-lucide-plus class="size-3.5" />
        New file
      </button>
    </div>

    <p v-if="openError" class="mb-3 text-xs text-danger" role="alert">{{ openError }}</p>

    <div
      v-if="hasDocuments"
      class="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
    >
      <div v-for="document in documents" :key="document.id" class="group relative min-w-0">
        <button
          type="button"
          class="w-full text-left"
          @click="openDocument(document.id, document.name, document.updatedAt)"
        >
          <div
            v-workspace-preview="document.id"
            class="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-border bg-panel-field transition-colors group-hover:border-panel-focus"
          >
            <img
              v-if="previewURL(document.id)"
              :src="previewURL(document.id) ?? undefined"
              alt=""
              class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
            />
            <icon-lucide-file-image v-else class="size-8 text-muted/40" />
          </div>
          <p class="mt-2 truncate text-xs font-medium">{{ document.name }}</p>
          <p class="mt-0.5 truncate text-[10px] text-muted">
            {{ relativeTime(document.updatedAt) }}
          </p>
        </button>
        <button
          type="button"
          class="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded bg-panel/80 text-muted opacity-0 hover:text-amber-400 group-hover:opacity-100"
          :class="{ 'opacity-100 text-amber-400': favoritedIds.has(document.id) }"
          :aria-label="favoritedIds.has(document.id) ? 'Remove from favorites' : 'Add to favorites'"
          @click="toggleFavorite(document)"
        >
          <icon-lucide-star class="size-3.5" :class="{ 'fill-current': favoritedIds.has(document.id) }" />
        </button>
      </div>
    </div>

    <div
      v-else
      class="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-muted sm:py-6"
    >
      No files in this project yet.
    </div>
  </section>
</template>
