# Grandpa's Studio hosted layer

This is a fork of [open-pencil/open-pencil](https://github.com/open-pencil/open-pencil),
pinned at commit `cb7ceea61ab1a419374f9af9bde05d033be0881f` (tag `pinned-base`), with a
teams/projects/accounts layer added on top for Grandpa's Studio's internal use.

Upstream is pre-1.0 and moves fast. We rebase deliberately, not automatically — see
"Updating from upstream" below.

## What's ours vs upstream

**New, isolated files** (safe — no merge conflict risk with upstream):
- `hosted-server/` — the whole backend service (Hono + Postgres), not part of upstream at all
- `src/app/integrations/storage/hosted/` — our `StorageAdapter` implementation
- `src/app/hosted/` — auth store/api, navigation store, hierarchy api
- `src/components/hosted/` — dashboard UI (TeamSwitcher, Sidebar, ProjectGrid, FavoritesSection)
- `src/views/LoginView.vue`, `src/views/InviteAcceptView.vue`

**Touched upstream files** (the only merge-conflict risk on a future rebase):
- `src/app/collab/transport/index.ts` — added a third `'hosted-ws'` branch (Phase 6)
- `src/app/tabs/index.ts` — added a per-tab navigation-context side map (does not change the `Tab`/`TabKind` types)
- `src/app/integrations/storage/providers.ts` — registered the hosted storage provider alongside S3
- `src/router.ts` — added `/login`, `/invite/:token` routes
- `src/components/home/HomeWorkspace.vue` — added a hosted-mode rendering branch

## Updating from upstream

```sh
git fetch upstream
git log pinned-base..upstream/master --oneline   # see what changed
git rebase upstream/master                        # only when ready to absorb it
```

Re-verify the five touched files above still apply cleanly and that
`StorageAdapter`/`CollabRoomTransport` shapes haven't changed before deploying.

## Plan

Full implementation plan: see the project's Claude Code plan history, or ask — phases are
tracked as: 0 (this file) → 1 (backend) → 2 (auth wiring) → 3 (dashboard UI) → 4 (thumbnails)
→ 5 (deployment) → 6 (server-relayed realtime, deferred).
