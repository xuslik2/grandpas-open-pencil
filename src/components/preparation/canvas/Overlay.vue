<script setup lang="ts">
import { useNow } from '@vueuse/core'
import { ProgressIndicator, ProgressRoot } from 'reka-ui'
import { computed } from 'vue'

import type { EditorPreparation } from '@/app/editor/preparation/types'
import {
  formatElapsed,
  preparationLabel,
  preparationPercent,
  preparationStep
} from '@/components/preparation/presentation'

const { preparation } = defineProps<{
  preparation: EditorPreparation
}>()

const now = useNow({ interval: 500 })

const label = computed(() => preparationLabel(preparation))
const step = computed(() => preparationStep(preparation))
// Fine-grained counts (bytes, fonts) when the current phase reports
// them; otherwise fall back to how far through the phase sequence we
// are, so the bar still moves during long, uncounted stretches.
const detailedPercent = computed(() => preparationPercent(preparation.progress))
const progressValue = computed(() => detailedPercent.value ?? step.value?.percent ?? null)
const progressSteps = computed(() => Math.round(progressValue.value ?? 0))
const elapsed = computed(() => formatElapsed(now.value.getTime() - preparation.startedAt))
// Large documents can sit in one phase for a while; say so rather than
// letting a still-looking screen read as a hang.
const slow = computed(() => now.value.getTime() - preparation.startedAt > 10_000)
</script>

<template>
  <Transition leave-active-class="transition-opacity duration-300" leave-to-class="opacity-0">
    <div
      data-test-id="canvas-loading"
      role="status"
      aria-live="polite"
      :aria-label="label"
      class="absolute inset-0 z-50 flex items-center justify-center bg-canvas"
    >
      <div class="flex w-72 flex-col items-center gap-3 text-center">
        <icon-lucide-pencil-line class="size-8 text-surface opacity-45" />
        <div class="space-y-1">
          <p class="text-sm font-medium text-surface/80">{{ label }}</p>
          <p v-if="preparation.detail" class="truncate text-xs text-surface/45">
            {{ preparation.detail }}
          </p>
        </div>
        <ProgressRoot
          :model-value="progressValue"
          class="h-0.5 w-40 overflow-hidden rounded-full bg-surface/8"
        >
          <ProgressIndicator
            v-if="progressValue === null"
            class="h-full w-2/5 animate-[slide_1s_ease-in-out_infinite] rounded-full bg-surface/25"
          />
          <div v-else class="flex h-full w-full">
            <span
              v-for="s in 100"
              :key="s"
              :data-complete="s <= progressSteps"
              class="h-full flex-1 bg-transparent transition-colors duration-150 data-[complete=true]:bg-surface/35"
            />
          </div>
        </ProgressRoot>
        <div class="flex items-center gap-2 text-xs tabular-nums text-surface/45">
          <span v-if="step">Step {{ step.index }} of {{ step.total }}</span>
          <span v-if="step" class="text-surface/25">·</span>
          <span>{{ elapsed }}</span>
        </div>
        <p v-if="detailedPercent !== null" class="text-xs tabular-nums text-surface/35">
          {{ preparation.progress?.completed }} of {{ preparation.progress?.total }}
          {{ preparation.progress?.unit }}
        </p>
        <p v-else-if="slow" class="max-w-64 text-xs text-surface/35">
          Large documents can take a while on this step — still working.
        </p>
      </div>
    </div>
  </Transition>
</template>
