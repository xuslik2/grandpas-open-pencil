<script setup lang="ts">
import { onMounted } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'

import { provideEditor, useI18n } from '@open-pencil/vue'
import AppShell from '@/components/Shell/AppShell.vue'
import AppToast from '@/components/Shell/AppToast.vue'
import PublishLibraryDialog from '@/components/libraries/PublishLibraryDialog.vue'
import LibraryUpdateReviewDialog from '@/components/libraries/review/LibraryUpdateReviewDialog.vue'
import RecoveryDialog from '@/components/recovery/RecoveryDialog.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import { useAppTheme } from '@/app/shell/theme'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'
import { endRiskyOperation, lastClaimedCrash } from '@/app/storage/crash-guard'
import { kickSyncEngine } from '@/app/storage/sync'
import { prepareForReload } from '@/app/tabs'

const store = useEditorStore()
const { updates, locale } = useI18n()

useHead({
  titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil'),
  htmlAttrs: { lang: locale }
})

provideEditor(store)
useAppTheme()
useEventListener(window, 'pagehide', () => {
  // pagehide fires when the page goes away normally — reload, close,
  // navigation — but not when the renderer is killed. Clearing the marker
  // here is precisely what distinguishes the two, so reloading during a
  // slow upload isn't mistaken for a crash and doesn't quarantine a
  // perfectly healthy document.
  endRiskyOperation()
  void prepareForReload()
})

onMounted(() => {
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(updates)

  // Say so rather than silently skipping it — the document is genuinely
  // not being synced or opened any more, and the user is the one who has
  // to decide what to do about that.
  const crashed = lastClaimedCrash()
  if (crashed) {
    toast.error(
      `"${crashed.label}" stopped responding last time and has been paused. ` +
        'Other documents are unaffected.'
    )
  }

  void kickSyncEngine()
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <AppShell>
      <RouterView />
    </AppShell>
    <SettingsDialog />
    <RecoveryDialog />
    <PublishLibraryDialog />
    <LibraryUpdateReviewDialog />
    <AppToast />
  </TooltipProvider>
</template>
