import { createRouter, createWebHistory } from 'vue-router'

import WorkspaceView from './views/WorkspaceView.vue'
import LoginView from './views/LoginView.vue'
import { IS_TAURI } from '@/constants'
import { currentUser, refreshCurrentUser } from '@/app/hosted/auth/store'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: WorkspaceView },
    { path: '/storage', redirect: '/' },
    { path: '/demo', component: WorkspaceView, meta: { demo: true } },
    { path: '/share/:roomId', component: WorkspaceView },
    { path: '/login', component: LoginView }
  ]
})

// Hosted deployments (web only — not the Tauri desktop app) require an
// account: no anonymous local-only editing left reachable. See HOSTED.md.
if (!IS_TAURI) {
  router.beforeEach(async (to) => {
    if (currentUser.get() === undefined) {
      await refreshCurrentUser()
    }
    const loggedIn = currentUser.get() != null
    if (!loggedIn && to.path !== '/login') return '/login'
    if (loggedIn && to.path === '/login') return '/'
    return true
  })
}

export default router
