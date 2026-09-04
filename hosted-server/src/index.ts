import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './routes/auth.js'
import { teamRoutes } from './routes/teams.js'
import { projectRoutes, folderRoutes } from './routes/projects.js'
import { documentRoutes } from './routes/documents.js'
import { assetRoutes } from './routes/assets.js'

const app = new Hono().basePath('/api')

const origin = process.env.PUBLIC_ORIGIN
app.use(
  '*',
  cors({
    origin: origin ? [origin] : [],
    credentials: true,
  })
)

app.get('/health', (c) => c.json({ ok: true }))
app.route('/auth', authRoutes)
app.route('/teams', teamRoutes)
app.route('/projects', projectRoutes)
app.route('/folders', folderRoutes)
app.route('/documents', documentRoutes)
// Mounted under /teams so the routes read /api/teams/:teamId/assets/:hash —
// assets are team-scoped, same as everything else they belong to.
app.route('/teams', assetRoutes)

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`hosted-server listening on :${info.port}`)
})
