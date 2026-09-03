<script setup lang="ts">
import {
  canGoNext,
  canGoPrevious,
  currentSlide,
  currentSlideIndex,
  exitPresentMode,
  isPresenting,
  nextSlide,
  previousSlide,
  slideCount
} from '@/app/present/store'

function handleBackgroundClick(event: MouseEvent): void {
  const half = window.innerWidth / 2
  if (event.clientX < half) void previousSlide()
  else void nextSlide()
}
</script>

<template>
  <div
    v-if="isPresenting"
    class="fixed inset-0 z-50 cursor-pointer"
    data-test-id="present-overlay"
    @click="handleBackgroundClick"
  >
    <button
      type="button"
      class="absolute top-4 right-4 flex size-8 cursor-pointer items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
      aria-label="Exit presentation"
      @click.stop="exitPresentMode"
    >
      <icon-lucide-x class="size-4" />
    </button>

    <button
      v-if="canGoPrevious"
      type="button"
      class="absolute top-1/2 left-4 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
      aria-label="Previous slide"
      @click.stop="previousSlide"
    >
      <icon-lucide-chevron-left class="size-5" />
    </button>
    <button
      v-if="canGoNext"
      type="button"
      class="absolute top-1/2 right-4 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
      aria-label="Next slide"
      @click.stop="nextSlide"
    >
      <icon-lucide-chevron-right class="size-5" />
    </button>

    <div
      class="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/30 px-3 py-1 text-xs text-white/80"
    >
      {{ currentSlide?.name }} · {{ currentSlideIndex + 1 }} / {{ slideCount }}
    </div>
  </div>
</template>
