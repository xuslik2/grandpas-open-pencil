<script setup lang="ts">
import { enterPresentMode, hasPresentableSlides } from '@/app/present/store'
import CollabAvatarStack from '@/components/CollabPanel/CollabAvatarStack.vue'
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'

provideCollabPanel()

function present(): void {
  if (!hasPresentableSlides()) return
  void enterPresentMode()
}
</script>

<template>
  <div class="flex w-full items-center justify-end gap-2">
    <CollabAvatarStack />
    <div class="flex-1" />
    <button
      type="button"
      class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface disabled:pointer-events-none disabled:opacity-40"
      :disabled="!hasPresentableSlides()"
      aria-label="Present"
      title="Present"
      @click="present"
    >
      <icon-lucide-play class="size-3.5" />
    </button>
    <CollabSharePopover />
  </div>
</template>
