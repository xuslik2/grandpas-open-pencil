import type { StorageAdapter, StorageDocument } from '../types'
import { apiGet, apiGetBytes, apiGetOrNull, apiJson, apiPutBytes, HostedApiError } from './client'
import { resolveTargetProjectId } from './default-project'

type ApiDocument = {
  id: string
  name: string
  updated_at: string
  has_thumbnail?: boolean
}

function toStorageDocument(doc: ApiDocument): StorageDocument {
  return {
    id: doc.id,
    name: doc.name,
    updatedAt: doc.updated_at,
    thumbnailURL: doc.has_thumbnail ? `/api/documents/${doc.id}/thumbnail` : null,
    metadataAuthoritative: true
  }
}

// Creates the document row the first time putDocument sees an id the
// server doesn't know about yet — in whatever project was registered for
// it (dashboard "+ New file"), falling back to a lazily-resolved "Drafts"
// project otherwise (see default-project.ts). Idempotent server-side, so
// a racing duplicate create for the same id is harmless.
async function ensureDocumentExists(id: string, name: string): Promise<void> {
  const projectId = await resolveTargetProjectId(id)
  await apiJson('POST', `/projects/${projectId}/documents`, { id, name })
}

export function createHostedStorageAdapter(): StorageAdapter {
  return {
    async testConnection() {
      try {
        await apiGet('/auth/me')
        return { ok: true, message: 'Connected to Grandpa\'s Studio.' }
      } catch (err) {
        const message = err instanceof HostedApiError ? err.message : String(err)
        return { ok: false, message }
      }
    },

    async listDocuments() {
      const { documents } = await apiGet<{ documents: ApiDocument[] }>('/documents')
      return documents.map(toStorageDocument)
    },

    async getDocument(id, onProgress, signal) {
      signal?.throwIfAborted()
      const bytes = await apiGetBytes(`/documents/${id}/content`)
      if (!bytes) throw new Error(`Document not found: ${id}`)
      // No granular progress for hosted storage yet — internal team files
      // aren't expected to be huge enough for this to matter today.
      onProgress?.({ transferredBytes: bytes.length, totalBytes: bytes.length })
      return bytes
    },

    async putDocument(id, bytes, metadata, onProgress) {
      let res = await apiPutBytes(`/documents/${id}/content`, bytes)

      if (res.status === 404) {
        await ensureDocumentExists(id, metadata.name)
        res = await apiPutBytes(`/documents/${id}/content`, bytes)
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new HostedApiError(body.error ?? 'Failed to save document', res.status)
      }
      onProgress?.({ transferredBytes: bytes.length, totalBytes: bytes.length })

      // Keep the stored name in sync in case the document was renamed
      // locally since it was last saved.
      await apiJson('PATCH', `/documents/${id}`, { name: metadata.name }).catch(() => {
        // Non-fatal — content already saved successfully above.
      })
    },

    async getDocumentMetadata(id) {
      const doc = await apiGetOrNull<{ document: ApiDocument }>(`/documents/${id}`)
      return doc ? { name: doc.document.name, updatedAt: doc.document.updated_at } : null
    },

    async deleteDocument(id) {
      await fetch(`/api/documents/${id}`, { method: 'DELETE', credentials: 'include' })
    },

    async getUsage() {
      const { documentCount, bytesUsed } = await apiGet<{
        documentCount: number
        bytesUsed: number
      }>('/documents/usage')
      return { bytesUsed, objectCount: documentCount, documentCount }
    },

    async getThumbnail(id) {
      return apiGetBytes(`/documents/${id}/thumbnail`)
    },

    async putThumbnail(id, bytes) {
      const res = await apiPutBytes(`/documents/${id}/thumbnail`, bytes)
      if (!res.ok) throw new HostedApiError('Failed to save thumbnail', res.status)
    }
  }
}
