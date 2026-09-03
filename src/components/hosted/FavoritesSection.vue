<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listFavoriteDocuments, unfavoriteDocument, type ProjectDocument } from '@/app/hosted/hierarchy/api'
import { openStorageDocumentInNewTab } from '@/app/tabs'

const favorites = ref<ProjectDocument[]>([])
const loading = ref(true)
const openError = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    favorites.value = await listFavoriteDocuments()
  } finally {
    loading.value = false
  }
}

async function open(document: ProjectDocument) {
  openError.value = null
  try {
    await openStorageDocumentInNewTab({
      id: document.id,
      name: document.name,
      updatedAt: document.updated_at
    })
  } catch (err) {
    openError.value = err instanceof Error ? err.message : String(err)
  }
}

async function unfavorite(id: string) {
  favorites.value = favorites.value.filter((d) => d.id !== id)
  await unfavoriteDocument(id).catch(() => void load()) // resync on failure
}

onMounted(load)
defineExpose({ reload: load })
</script>

<template>
  <section v-if="!loading && favorites.length" class="mt-7">
    <h2 class="mb-3 flex items-center gap-1.5 text-base font-semibold">
      <icon-lucide-star class="size-4 fill-current text-amber-400" />
      Favorites
    </h2>
    <p v-if="openError" class="mb-3 text-xs text-danger" role="alert">{{ openError }}</p>
    <div class="overflow-hidden rounded-lg border border-border">
      <div
        v-for="document in favorites"
        :key="document.id"
        class="group flex min-h-14 w-full items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-hover sm:min-h-0 sm:px-4 sm:py-3"
      >
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="open(document)">
          <icon-lucide-file-image class="size-4 shrink-0 text-accent" />
          <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ document.name }}</span>
        </button>
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:bg-hover hover:text-surface group-hover:opacity-100"
          aria-label="Remove from favorites"
          @click="unfavorite(document.id)"
        >
          <icon-lucide-star class="size-3.5 fill-current text-amber-400" />
        </button>
      </div>
    </div>
  </section>
</template>
