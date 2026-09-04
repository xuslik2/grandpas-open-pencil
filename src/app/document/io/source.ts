import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportDocumentForStorage } from '@/app/document/io/export-for-storage'

import { createAutosave } from '@/app/document/autosave'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import type { DocumentSourceAccess } from '@/app/document/io/types'
import { createDocumentRecovery } from '@/app/document/recovery'
import { recoveryEnabled } from '@/app/document/recovery/preferences'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

export { createDocumentSourceState }

type DocumentSourceOptions = DocumentSourceAccess & {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getRenderer: () => Editor['renderer']
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getStorageBinding,
  setStorageBinding,
  setSourceIdentity,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer
}: DocumentSourceOptions) {
  function buildFigFile() {
    const renderer = getRenderer()
    return exportDocumentForStorage({
      graph: editor.graph,
      binding: getStorageBinding(),
      ck: renderer?.ck,
      renderer: renderer ?? undefined,
      pageId: state.currentPageId
    })
  }

  // Everything that hands a .fig to somewhere outside this app — a
  // download, Save As onto disk — needs the images in it, even when the
  // document's own storage keeps them separately. Otherwise the file
  // opens elsewhere with every image missing.
  function buildPortableFigFile() {
    const renderer = getRenderer()
    return exportDocumentForStorage({
      graph: editor.graph,
      binding: null,
      ck: renderer?.ck,
      renderer: renderer ?? undefined,
      pageId: state.currentPageId
    })
  }

  function buildRecoveryFigFile() {
    // Same small archive as a real save when the document's images live
    // on the server, but without uploading anything — a recovery
    // snapshot has to work when the network is exactly what broke.
    return exportDocumentForStorage({
      graph: editor.graph,
      binding: getStorageBinding(),
      pageId: state.currentPageId,
      skipAssetUpload: true
    })
  }

  const recovery = createDocumentRecovery({
    state,
    isEnabled: () => recoveryEnabled.value,
    buildFigFile: buildRecoveryFigFile,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding()
  })

  const { saveFigFile, saveFigFileAs, writeFile } = createSaveActions({
    state,
    buildFigFile,
    buildPortableFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    getStorageBinding,
    setStorageBinding,
    setSourceIdentity,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    },
    onWriteSuccess: (version) => recovery.markProtectedVersion(version),
    onDownloadSuccess: (version) => recovery.markProtectedVersion(version)
  })

  // How big the document actually is once encoded — only known after a
  // save, which is fine: it just paces later saves (see autosave's
  // delay steps), and the first save of a session is never the problem.
  let lastDocumentBytes: number | null = null

  const autosave = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => !!getFileHandle() || !!getFilePath() || !!getStorageBinding(),
    getLastDocumentBytes: () => lastDocumentBytes,
    saveCurrentDocument: async (version) => {
      const data = await buildFigFile()
      lastDocumentBytes = data.byteLength
      await writeFile(data, version)
    }
  })

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    setStorageBinding(null)
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSourceIdentity({ handle: handle ?? null, path: path ?? null })
    setSavedVersion(state.sceneVersion)
    void recovery.markProtectedVersion(state.sceneVersion)
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setStorageDocumentSource(
    binding: StorageDocumentBinding,
    documentName: string,
    options?: { markSaved?: boolean }
  ) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(null)
    setDownloadName(`${documentName}.fig`)
    setSourceIdentity({ handle: null, path: null })
    setStorageBinding(binding)
    state.documentName = documentName
    state.autosaveEnabled = true
    // Skippable: a brand-new blank document has nothing to save yet, so
    // stamping the current (baseline) version as "saved" is correct. A
    // document that already has real content at bind time (an import)
    // needs that content to actually reach the server — see requestSave.
    if (options?.markSaved ?? true) {
      setSavedVersion(state.sceneVersion)
      void recovery.markProtectedVersion(state.sceneVersion)
    }
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setStorageBinding(null)
    setFileHandle(null)
    setFilePath(path)
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    stopWatchingFile()
    autosave.disposeAutosave()
    recovery.disposeRecovery()
  }

  // Autosave only fires reactively when sceneVersion changes after the
  // savedVersion watermark — setStorageDocumentSource stamps that
  // watermark to "current" as part of binding a fresh blank document
  // (nothing to save yet, by design). A caller that binds storage to a
  // document that already has real content (e.g. an imported file) needs
  // to explicitly ask for that content to be saved, since no further
  // sceneVersion change will happen on its own to trigger the watcher.
  function requestSave(): Promise<void> {
    return autosave.requestSave(state.sceneVersion)
  }

  return {
    setDocumentSource,
    setStorageDocumentSource,
    setPlannedFilePath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    requestSave,
    saveFigFile,
    saveFigFileAs,
    getStorageBinding,
    getRecoveryId: () => recovery.getRecoveryId(),
    adoptRecoverySnapshot: (id: string, version: number) =>
      recovery.adoptRecoverySnapshot(id, version),
    persistRecoveryNow: () => recovery.persistNow(),
    discardRecovery: () => recovery.discardRecovery()
  }
}
