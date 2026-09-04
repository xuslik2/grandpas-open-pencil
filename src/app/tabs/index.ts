import { promiseTimeout } from '@vueuse/core'
import { shallowRef, computed, triggerRef } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { findFigThumbnailPageId } from '@open-pencil/core/io/formats/fig'
import { renderThumbnail } from '@open-pencil/core/io/formats/raster'
import { populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { setOpenPencilStore } from '@/app/browser-bridge'
import { describeDiagnosticError, recordStorageFailure } from '@/app/diagnostics'
import { readFigDocument } from '@/app/document/io/fig'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import type { DocumentSourceIdentity } from '@/app/document/io/types'
import { getRecoveryStore, type RecoverySnapshotMeta } from '@/app/document/recovery'
import { setActiveEditorStore } from '@/app/editor/active-store'
import type { EditorPreparationHandle as DocumentLoadSession } from '@/app/editor/preparation/types'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { notificationMessages } from '@/app/i18n/notifications'
import {
  activeStorageProviderID,
  createActiveStorageAdapter,
  storagePreferencesComplete,
  type StorageDocument,
  type StorageTransferProgress
} from '@/app/integrations/storage'
import { IS_TAURI } from '@/constants'
import { registerPendingProject } from '@/app/integrations/storage/hosted/default-project'
import {
  registerHostedImageSource,
  teamIdForDocument
} from '@/app/integrations/storage/hosted/assets'
import {
  cacheRecentFileThumbnail,
  loadCachedRecentFileThumbnail,
  rememberRecentStorageDocument
} from '@/app/recent-files'
import { toast } from '@/app/shell/ui'
import { getLocalCanvasStore } from '@/app/storage/local-store'
import { seedStorageCanvasFromRemote } from '@/app/storage/sync/persist'
import { onStorageWorkspaceEvent } from '@/app/storage/workspace/events'
import { createFileOpenCoordinator } from '@/app/tabs/open/coordinator'
import { findTabByFileIdentity } from '@/app/tabs/open/identity'

export type TabKind = 'home' | 'document'

export interface Tab {
  id: string
  store: EditorStore
  kind: TabKind
}

const io = new IORegistry(BUILTIN_IO_FORMATS)
const fileOpenCoordinator = createFileOpenCoordinator()
const RECENT_FILE_THUMBNAIL_SIZE = 512
const coverThumbnailListeners = new WeakMap<EditorStore, () => void>()

let nextTabId = 1

function generateTabId(): string {
  return `tab-${nextTabId++}`
}

const tabsRef = shallowRef<Tab[]>([])
const activeTabId = shallowRef('')

export const activeTab = computed(() => tabsRef.value.find((t) => t.id === activeTabId.value))

export const allTabs = computed(() =>
  tabsRef.value.map((t) => ({
    id: t.id,
    name: t.store.state.documentName,
    isHome: t.kind === 'home',
    isPreparing: t.store.state.preparation !== null,
    preparationProgress: t.store.state.preparation?.progress ?? null,
    isActive: t.id === activeTabId.value
  }))
)

export function getActiveStore(): EditorStore {
  const tab = tabsRef.value.find((t) => t.id === activeTabId.value)
  if (!tab) throw new Error('No active tab')
  return tab.store
}

export function getActiveTabId(): string {
  return activeTabId.value
}

export function getTabById(tabId: string): Tab | undefined {
  return tabsRef.value.find((tab) => tab.id === tabId)
}

export function getTabForStore(store: EditorStore): Tab | undefined {
  return tabsRef.value.find((tab) => tab.store === store)
}

export function getTabsSnapshot(): Tab[] {
  return [...tabsRef.value]
}

// True when this deployment should autosave documents to hosted team
// storage rather than stay local-only — used both for brand-new blank
// documents and for local-file imports (see openFileInNewTab below).
// Desktop (Tauri) builds keep the upstream default of plain local-only
// files, matching the existing "Save As" / native-file workflow there.
function isHostedStorageActive(): boolean {
  return !IS_TAURI && storagePreferencesComplete(activeStorageProviderID.value)
}

// A fresh blank document should autosave to the team's storage from the
// moment it exists, not stay local-only until an explicit "Save to..."
// action. The document row on the server itself is created lazily on
// first save (see integrations/storage/hosted/adapter.ts's
// ensureDocumentExists), not here — this just makes sure the write path
// has somewhere to send it. Called from every path that turns a store
// into a real, editable document for the first time — createTab, and
// leaveHome (the "+ New design" button from the dashboard reuses the
// home tab's already-existing store rather than creating a new one via
// createTab, so it needs this too; found by testing that flow
// specifically, not by reading createTab in isolation).
function bindNewDocumentToHostedStorage(store: EditorStore): void {
  if (store.getStorageBinding()) return // already bound — don't clobber
  if (!isHostedStorageActive()) return
  store.setStorageDocumentSource(
    { providerId: activeStorageProviderID.value, documentId: crypto.randomUUID() },
    'Untitled'
  )
}

export function createTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const isBrandNew = !store
  const s = store ?? createEditorStore(initialGraph)

  if (isBrandNew) bindNewDocumentToHostedStorage(s)

  const tab: Tab = { id: generateTabId(), store: s, kind: 'document' }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

// Dashboard's "+ New file in project X": same local-document creation as
// a plain new tab (createTab already produces a genuinely valid blank
// .fig — reusing it here instead of pre-seeding empty bytes server-side,
// which isn't a valid zip container and fails to open), just targeted at
// a specific project instead of the generic Drafts fallback.
export function createDocumentInProject(projectId: string): Tab {
  const tab = createTab()
  const binding = tab.store.getStorageBinding()
  if (binding) registerPendingProject(binding.documentId, projectId)
  return tab
}

export function createHomeTab(): Tab {
  const tab: Tab = { id: generateTabId(), store: createEditorStore(), kind: 'home' }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

export function leaveHome(tabId: string): void {
  const tabIndex = tabsRef.value.findIndex((candidate) => candidate.id === tabId)
  if (tabIndex === -1) return
  const tab = tabsRef.value[tabIndex]
  if (tab.kind !== 'home') return
  bindNewDocumentToHostedStorage(tab.store)
  tabsRef.value = tabsRef.value.with(tabIndex, { ...tab, kind: 'document' })
}

export function createDocumentInCurrentTab(): Tab {
  const current = activeTab.value
  if (current?.kind !== 'home') return createTab()
  leaveHome(current.id)
  return getTabById(current.id) ?? current
}

export function showNewTab(): void {
  const homeTab = tabsRef.value.find((tab) => tab.kind === 'home')
  if (homeTab) {
    switchTab(homeTab.id)
    return
  }
  createHomeTab()
}

function activateTab(tab: Tab) {
  const previous = tabsRef.value.find((candidate) => candidate.id === activeTabId.value)
  previous?.store.setSnapGuides([])
  previous?.store.setLayoutInsertIndicator(null)
  previous?.store.setDropTarget(null)
  activeTabId.value = tab.id
  setActiveEditorStore(tab.store)
  triggerRef(tabsRef)
  setOpenPencilStore(tab.store)
}

export function switchTab(tabId: string) {
  const tab = tabsRef.value.find((t) => t.id === tabId)
  if (!tab) return
  activateTab(tab)
}

export async function closeTab(tabId: string): Promise<void> {
  const idx = tabsRef.value.findIndex((t) => t.id === tabId)
  if (idx === -1) return

  const closingTab = tabsRef.value[idx]
  if (closingTab.kind === 'home' && tabsRef.value.length === 1) return
  const wasActive = activeTabId.value === tabId
  coverThumbnailListeners.get(closingTab.store)?.()
  coverThumbnailListeners.delete(closingTab.store)
  closingTab.store.preparationController.dispose()
  await closingTab.store.persistRecoveryNow()
  closingTab.store.dispose()
  tabsRef.value = tabsRef.value.filter((t) => t.id !== tabId)

  if (tabsRef.value.length === 0) {
    createHomeTab()
    return
  }

  if (wasActive) {
    const newIdx = Math.min(idx, tabsRef.value.length - 1)
    activateTab(tabsRef.value[newIdx])
  }
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function isDOMImportFile(file: File): boolean {
  return /\.(html?|xhtml)$/i.test(file.name)
}

function reusableTabStore(): { store: EditorStore; created: boolean } {
  const current = activeTab.value
  if (current?.kind === 'home') {
    leaveHome(current.id)
    return { store: current.store, created: false }
  }
  const isUntouched =
    current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
  if (isUntouched) {
    leaveHome(current.id)
    return { store: current.store, created: false }
  }
  return { store: createTab().store, created: true }
}

async function readFigForTab(file: Blob, signal?: AbortSignal): Promise<SceneGraph> {
  const imported = await readFigDocument(file, signal)
  const firstPageId = imported.getPages()[0]?.id
  if (firstPageId) computeAllLayouts(imported, firstPageId)
  const coverPageId = findFigThumbnailPageId(imported.getPages())
  if (coverPageId && coverPageId !== firstPageId) {
    populateLazyFigImportRoots(imported, [coverPageId])
    computeAllLayouts(imported, coverPageId)
  }
  return imported
}

async function showImportedGraph(
  store: EditorStore,
  graph: SceneGraph,
  prepare?: () => void | Promise<void>,
  load?: DocumentLoadSession
): Promise<void> {
  load?.update({ phase: 'materializing', detail: store.state.documentName })
  await applyImportedDocument(store, graph, load)
  load?.signal.throwIfAborted()
  await prepare?.()
  load?.signal.throwIfAborted()
  const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
  load?.update({ phase: 'populating-page', detail: store.graph.getNode(pageId)?.name ?? null })
  await store.switchPage(pageId, { preparation: load })
  load?.signal.throwIfAborted()
  load?.update({ phase: 'preparing-render', detail: store.state.documentName })
  await store.fitCurrentPageToViewport()
}

async function cacheOpenedFigCover(path: string, store: EditorStore): Promise<void> {
  if (await loadCachedRecentFileThumbnail(path)) return
  const coverPageId = findFigThumbnailPageId(store.graph.getPages())
  if (!coverPageId) return
  for (let attempt = 0; attempt < 240 && !store.renderer; attempt++) {
    await promiseTimeout(250)
  }
  const renderer = store.renderer
  if (!renderer) {
    console.warn('[Recent files] Cover thumbnail skipped because the renderer was unavailable')
    return
  }
  const bytes = renderThumbnail(
    renderer.ck,
    renderer,
    store.graph,
    coverPageId,
    RECENT_FILE_THUMBNAIL_SIZE,
    RECENT_FILE_THUMBNAIL_SIZE
  )
  if (!bytes) {
    console.warn('[Recent files] Cover thumbnail skipped because the Cover page was empty')
    return
  }
  await cacheRecentFileThumbnail(path, bytes)
}

function watchOpenedFigCover(path: string, store: EditorStore): void {
  coverThumbnailListeners.get(store)?.()
  const coverPageId = findFigThumbnailPageId(store.graph.getPages())
  if (!coverPageId) return
  coverThumbnailListeners.set(
    store,
    store.onEditorEvent('page:changed', (pageId) => {
      if (pageId !== coverPageId) return
      void cacheOpenedFigCover(path, store).catch((error) => {
        console.warn('[Recent files] Failed to cache the Cover thumbnail', error)
      })
    })
  )
}

function findStorageTab(providerId: string, documentId: string): Tab | undefined {
  return tabsRef.value.find((tab) => {
    const binding = tab.store.getStorageBinding()
    return binding?.providerId === providerId && binding.documentId === documentId
  })
}

// Dashboard card thumbnails: re-render and upload the first page whenever
// a storage-bound document finishes syncing. Unlike cacheOpenedFigCover
// (local files, above), this doesn't require a page named "Cover" — any
// provider whose adapter implements putThumbnail gets one from whatever
// the first page is. Best-effort: skipped if the document isn't open
// right now or its renderer isn't ready yet, since there's nothing to
// rasterize without a live renderer — the next successful save while
// open will catch it.
onStorageWorkspaceEvent((event) => {
  if (event.kind !== 'synced' || !event.documentId) return
  void updateStorageDocumentThumbnail(event.providerId, event.documentId)
})

async function updateStorageDocumentThumbnail(
  providerId: string,
  documentId: string
): Promise<void> {
  const tab = findStorageTab(providerId, documentId)
  if (!tab) return
  const { renderer, graph } = tab.store
  if (!renderer) return
  const pageId = graph.getPages()[0]?.id
  if (!pageId) return

  const bytes = renderThumbnail(
    renderer.ck,
    renderer,
    graph,
    pageId,
    RECENT_FILE_THUMBNAIL_SIZE,
    RECENT_FILE_THUMBNAIL_SIZE
  )
  if (!bytes) return

  const adapter = createActiveStorageAdapter(providerId)
  if (!adapter.putThumbnail) return
  try {
    await adapter.putThumbnail(documentId, bytes)
  } catch (error) {
    console.warn('[Storage] Failed to update document thumbnail:', error)
  }
}

function failPreparation(
  load: DocumentLoadSession,
  code: 'read-failed' | 'decode-failed',
  error: unknown
): void {
  if (load.signal.aborted) return
  load.fail({
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: true
  })
}

export async function openStorageDocumentInNewTab(document: StorageDocument): Promise<void> {
  const providerId = activeStorageProviderID.value
  const existing = findStorageTab(providerId, document.id)
  if (existing) {
    switchTab(existing.id)
    rememberRecentStorageDocument(providerId, document.id, document.name)
    return
  }

  const { store, created } = reusableTabStore()
  store.state.documentName = document.name
  const load = store.preparationController.begin({
    kind: 'storage-open',
    subject: document.name
  })
  let succeeded = false
  try {
    load.update({ phase: 'reading', detail: document.name })
    const local = getLocalCanvasStore()
    const localMetadata = await local.getMeta(document.id)
    load.signal.throwIfAborted()
    const localBytes = localMetadata?.hasFig ? await local.readFig(document.id) : null
    load.signal.throwIfAborted()
    const localIsAuthoritative =
      localMetadata?.syncStatus !== 'synced' ||
      !document.metadataAuthoritative ||
      localMetadata.updatedAt >= document.updatedAt
    // Blob throughout wherever the adapter supports it. Every step below
    // — the local cache write, and the parse itself — takes a Blob
    // without copying, so the document's bytes are never materialised on
    // the main thread. A trace of this path opening a 163MB document
    // showed it dying here with the JS heap at 200MB of a 4096MB limit:
    // the buffers that exhausted the renderer were all off-heap, and
    // there were four of them back to back.
    let content: Uint8Array | Blob | null = localBytes && localIsAuthoritative ? localBytes : null

    if (!content) {
      const adapter = createActiveStorageAdapter(providerId)
      const onProgress = (progress: StorageTransferProgress) =>
        load.update({
          phase: 'reading',
          detail: document.name,
          completed: progress.transferredBytes,
          total: progress.totalBytes,
          unit: 'bytes'
        })

      content = adapter.getDocumentBlob
        ? await adapter.getDocumentBlob(document.id, onProgress, load.signal)
        : await adapter.getDocument(document.id, onProgress, load.signal)

      await seedStorageCanvasFromRemote({
        providerId,
        canvasId: document.id,
        name: document.name,
        updatedAt: document.updatedAt,
        figBytes: content
      })
      load.signal.throwIfAborted()
    }

    // A Blob is reused as-is rather than being copied into a File: the
    // parser only needs something it can read ranges from, and wrapping
    // it would copy the whole document into blob storage again for the
    // sake of a filename nothing reads.
    const source =
      content instanceof Blob
        ? content
        : new File([content], `${document.name}.fig`, { type: 'application/octet-stream' })
    load.update({ phase: 'decoding', detail: document.name })
    const imported = await readFigForTab(source, load.signal)

    // Documents saved to hosted storage carry no images in their archive
    // — they live in the team's content-addressed asset store. Wiring
    // that up has to happen before the graph is shown, because showing it
    // switches to a page, and that's what asks for the page's images.
    if (providerId === 'hosted-server') {
      try {
        registerHostedImageSource(imported, await teamIdForDocument(document.id))
      } catch (error) {
        // Non-fatal: a document whose images can't be located still opens
        // and edits, it just renders those fills empty.
        console.warn('[assets] could not attach hosted image source:', error)
      }
    }
    load.signal.throwIfAborted()

    await showImportedGraph(
      store,
      imported,
      () => store.setStorageDocumentSource({ providerId, documentId: document.id }, document.name),
      load
    )
    rememberRecentStorageDocument(providerId, document.id, document.name)
    succeeded = true
  } catch (error) {
    if (!load.signal.aborted) {
      const diagnostic = describeDiagnosticError(error)
      load.fail({
        code: 'read-failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: diagnostic.retryable ?? true
      })
      recordStorageFailure({ operation: 'download', ...diagnostic })
      toast.error(
        notificationMessages.get().openFileFailed({
          name: document.name,
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }
    if (created) {
      const tab = getTabForStore(store)
      if (tab) await closeTab(tab.id)
    }
    throw error
  } finally {
    if (succeeded) load.complete()
  }
}

export async function openFileInNewTab(
  file: File,
  handle?: FileSystemFileHandle,
  path?: string,
  /**
   * Hosted mode only: land the imported document in this project instead
   * of the Drafts fallback. Used by the dashboard's per-project import.
   */
  targetProjectId?: string
): Promise<void> {
  const identity: DocumentSourceIdentity = {
    handle: handle ?? null,
    path: path ?? null
  }
  const decision = await fileOpenCoordinator.decide(async () => {
    const pending = await fileOpenCoordinator.findPending(identity)
    if (pending) {
      const tab = getTabForStore(pending.store)
      if (tab) switchTab(tab.id)
      return { kind: 'pending' as const, completion: pending.completion }
    }

    const existing = await findTabByFileIdentity(tabsRef.value, identity)
    if (existing) {
      switchTab(existing.id)
      if (path?.toLowerCase().endsWith('.fig')) {
        watchOpenedFigCover(path, existing.store)
        void cacheOpenedFigCover(path, existing.store).catch((error) => {
          console.warn('[Recent files] Failed to cache the Cover thumbnail', error)
        })
      }
      return { kind: 'existing' as const }
    }

    const { store, created } = reusableTabStore()
    store.state.documentName = file.name.replace(/\.[^.]+$/i, '')
    const load = store.preparationController.begin({
      kind: isDOMImportFile(file) ? 'dom-import' : 'document-open',
      subject: file.name,
      fileBytes: file.size
    })

    const completion = Promise.withResolvers<undefined>()
    void completion.promise.catch(() => undefined)
    const pendingOpen = { completion: completion.promise, identity, store }
    fileOpenCoordinator.add(pendingOpen)
    return { kind: 'owner' as const, completion, pendingOpen, store, created, load }
  })

  if (decision.kind === 'existing') return
  if (decision.kind === 'pending') {
    await decision.completion
    return
  }

  const { completion, pendingOpen, store, created, load } = decision
  let succeeded = false
  try {
    if (isDOMImportFile(file)) {
      await store.openDOMFile(file, { handle, path, preparation: load })
      completion.resolve(undefined)
      succeeded = true
      return
    }

    await yieldToUI()
    load.update({ phase: 'reading', detail: file.name })
    const isFig = file.name.toLowerCase().endsWith('.fig')
    let imported: SceneGraph
    let sourceFormat: string
    if (isFig) {
      load.update({ phase: 'decoding', detail: file.name })
      imported = await readFigForTab(file, load.signal)
      sourceFormat = 'fig'
    } else {
      const result = await io.readDocument({
        name: file.name,
        mimeType: file.type || undefined,
        data: new Uint8Array(await file.arrayBuffer())
      })
      imported = result.graph
      sourceFormat = result.sourceFormat
    }

    const importedToHostedStorage = isHostedStorageActive()
    const firstPageId = imported.getPages()[0]?.id
    if (!isFig && firstPageId) computeAllLayouts(imported, firstPageId)
    // In a finally, not after the await: a large document can import and
    // display fine but still throw here when the renderer's first paint
    // exceeds the load session's timeout. That used to cost the whole
    // import — the document was on screen but never reached the team's
    // storage, so closing the tab lost it. The binding check keeps this
    // honest: it's only set once applyImportedDocument has actually
    // succeeded, so a genuine decode failure still saves nothing.
    try {
      await showImportedGraph(
        store,
        imported,
        () => {
          if (importedToHostedStorage) {
            // Hosted deployments: an imported file becomes a new document
            // owned by the team, like "+ New design" — not a reference to
            // the local filesystem. setDocumentSource's setStorageBinding
            // (null) would otherwise silently strip autosave's only save
            // target — confirmed by testing: imports never reached the
            // server, they just lived in the tab until it was closed.
            //
            // markSaved: false matters here and not for a blank "+ New
            // design": by this point applyImportedDocument already
            // populated the graph (real content, sceneVersion > 0), so
            // the normal "just bound, mark current version as already
            // saved" behavior would silently treat that imported content
            // as saved without ever writing it. The requestSave() itself
            // happens once showImportedGraph settles (see finally) —
            // calling it here, still inside this same preparation
            // session, raced its own export against the later
            // switchPage/fitCurrentPageToViewport steps and blew the
            // load session's timeout budget (confirmed by testing).
            const binding = store.getStorageBinding() ?? {
              providerId: activeStorageProviderID.value,
              documentId: crypto.randomUUID()
            }
            if (targetProjectId) registerPendingProject(binding.documentId, targetProjectId)
            store.setStorageDocumentSource(binding, file.name.replace(/\.[^.]+$/i, ''), {
              markSaved: false
            })
          } else {
            store.setDocumentSource(file.name, sourceFormat, handle, path)
            if (isFig && path) watchOpenedFigCover(path, store)
          }
        },
        load
      )
    } finally {
      if (importedToHostedStorage && store.getStorageBinding()) void store.requestSave()
    }
    if (isFig && path) {
      void cacheOpenedFigCover(path, store).catch((error) => {
        console.warn('[Recent files] Failed to cache the Cover thumbnail', error)
      })
    }
    completion.resolve(undefined)
    succeeded = true
  } catch (error) {
    failPreparation(load, 'decode-failed', error)
    completion.reject(error)
    // Only discard the tab when nothing usable was imported. A document
    // whose content loaded but whose first paint timed out is on screen
    // and (in hosted mode) already saved — closing it would throw away
    // work the user can plainly see, which is worse than leaving a slow
    // document open.
    const importedSomething = store.graph.getPages().length > 0 && store.graph.nodes.size > 1
    if (created && !importedSomething) {
      const tab = getTabForStore(store)
      if (tab) await closeTab(tab.id)
    }
    throw error
  } finally {
    if (succeeded) load.complete()
    fileOpenCoordinator.remove(pendingOpen)
  }
}

export async function listRecoverySnapshots(): Promise<RecoverySnapshotMeta[]> {
  return getRecoveryStore().list()
}

export async function discardRecoverySnapshot(id: string): Promise<void> {
  await getRecoveryStore().remove(id)
}

export async function restoreRecoverySnapshot(id: string): Promise<void> {
  const snapshot = await getRecoveryStore().read(id)
  if (!snapshot) throw new Error('Recovery snapshot is no longer available')

  const { store } = reusableTabStore()
  const load = store.preparationController.begin({
    kind: 'recovery-restore',
    subject: snapshot.documentName
  })
  let succeeded = false
  try {
    load.update({ phase: 'reading', detail: snapshot.documentName })
    const fileBytes = new Uint8Array(snapshot.figBytes)
    const file = new File([fileBytes.buffer], `${snapshot.documentName}.fig`, {
      type: 'application/octet-stream'
    })
    load.update({ phase: 'decoding', detail: snapshot.documentName })
    const imported = await readFigForTab(file, load.signal)

    await showImportedGraph(
      store,
      imported,
      async () => {
        store.state.documentName = snapshot.documentName
        await store.adoptRecoverySnapshot(id, snapshot.sceneVersion)
      },
      load
    )
    succeeded = true
  } catch (error) {
    failPreparation(load, 'decode-failed', error)
    throw error
  } finally {
    if (succeeded) load.complete()
  }
}

export async function prepareForReload(): Promise<void> {
  await Promise.all(tabsRef.value.map((tab) => tab.store.persistRecoveryNow()))
}

export function tabCount(): number {
  return tabsRef.value.length
}

export function useTabsStore() {
  return {
    tabs: allTabs,
    activeTabId,
    createHomeTab,
    createDocumentInCurrentTab,
    createTab,
    leaveHome,
    switchTab,
    closeTab,
    getActiveTabId,
    getTabById,
    getTabForStore,
    getTabsSnapshot,
    openFileInNewTab,
    openStorageDocumentInNewTab,
    listRecoverySnapshots,
    restoreRecoverySnapshot,
    discardRecoverySnapshot,
    prepareForReload,
    getActiveStore,
    tabCount
  }
}
