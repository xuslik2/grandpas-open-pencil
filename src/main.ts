import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import { reportAbandonedOpenTrace } from '@/app/diagnostics/open-trace'
import { preloadFonts } from '@/app/editor/fonts'
import { IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

// If the last document open never finished — the renderer was killed
// mid-open — its trace is still on disk from before the crash. Ship it
// now, while there's a live page to ship it from.
void reportAbandonedOpenTrace()

preloadFonts()
const head = createHead()
createApp(App).use(router).use(head).mount('#app')

if (!IS_TAURI) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
    return undefined
  })
}
