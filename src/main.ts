import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import { reportAbandonedOpenTrace } from '@/app/diagnostics/open-trace'
import { claimCrashedOperation } from '@/app/storage/crash-guard'
import { preloadFonts } from '@/app/editor/fonts'
import { IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

// If the last document open never finished — the renderer was killed
// mid-open — its trace is still on disk from before the crash. Ship it
// now, while there's a live page to ship it from.
void reportAbandonedOpenTrace()

// Before anything automatic runs. If the previous session died partway
// through work on a document, that document is quarantined here so the
// sync engine won't immediately retry it and kill this tab too — which is
// what turns one bad document into a site that cannot be opened at all.
claimCrashedOperation()

preloadFonts()
const head = createHead()
createApp(App).use(router).use(head).mount('#app')

if (!IS_TAURI) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
    return undefined
  })
}
