<script setup lang="ts">
import { enterPresentMode } from '@/app/present/store'
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'

provideCollabPanel()
</script>

<template>
  <div class="flex w-full items-center justify-end gap-2">
    <CollabAvatarStack />
    <div class="flex-1" />
    <button
      type="button"
      class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
      aria-label="Present"
      title="Present"
      @click="enterPresentMode"
    >
      <icon-lucide-play class="size-3.5" />
    </button>
    <CollabSharePopover />
  </div>
</template>
