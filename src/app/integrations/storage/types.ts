import type { CredentialResolver } from '@/app/settings/credentials/types'

export type StorageProviderID = string
export type StorageFieldID = string

export type StorageDocumentBinding = {
  providerId: StorageProviderID
  documentId: string
}

export type StorageTransferProgress = {
  transferredBytes: number
  totalBytes: number | null
}

export type StorageDocumentMetadata = {
  name: string
  updatedAt: string
}

export type StorageDocument = StorageDocumentMetadata & {
  id: string
  thumbnailURL?: string | null
  metadataAuthoritative?: boolean
}

export type StorageUsage = {
  bytesUsed: number
  objectCount: number
  documentCount: number
}

export type StorageConnectionResult = {
  ok: boolean
  message: string
}

export interface LibraryObjectSummary {
  key: string
  size: number | null
  etag: string | null
}

export interface LibraryObjectValue {
  bytes: Uint8Array | null
  etag: string | null
}

export interface LibraryObjectWriteOptions {
  ifMatch?: string
  ifNoneMatch?: '*'
}

export interface LibraryObjectStore {
  getObject(key: string): Promise<Uint8Array | null>
  getObjectValue?(key: string): Promise<LibraryObjectValue>
  putObject(
    key: string,
    bytes: Uint8Array,
    contentType: string,
    options?: LibraryObjectWriteOptions
  ): Promise<void>
  listObjects(prefix: string): Promise<LibraryObjectSummary[]>
}

export interface StorageAdapter {
  testConnection(): Promise<StorageConnectionResult>
  listDocuments(): Promise<StorageDocument[]>
  getDocument(
    id: string,
    onProgress?: (progress: StorageTransferProgress) => void,
    signal?: AbortSignal
  ): Promise<Uint8Array>
  /**
   * The same content as getDocument, as a Blob.
   *
   * Preferred wherever it exists: the bytes stay off the JS heap, can be
   * handed to IndexedDB and to a worker without being copied, and are
   * never materialised on the main thread at all. getDocument's
   * Uint8Array costs a full document-size allocation before anything
   * else has even started — for a large document, several in a row, which
   * is enough to take the renderer down.
   */
  getDocumentBlob?(
    id: string,
    onProgress?: (progress: StorageTransferProgress) => void,
    signal?: AbortSignal
  ): Promise<Blob>
  putDocument(
    id: string,
    /**
     * A Blob is preferred and is what the sync engine sends: it uploads
     * straight from storage without the document ever being allocated on
     * the calling thread.
     */
    bytes: Uint8Array | Blob,
    metadata: StorageDocumentMetadata,
    onProgress?: (progress: StorageTransferProgress) => void
  ): Promise<void>
  deleteDocument(id: string): Promise<void>
  getDocumentMetadata?(id: string): Promise<StorageDocumentMetadata | null>
  getUsage(): Promise<StorageUsage>
  getThumbnail?(id: string): Promise<Uint8Array | null>
  putThumbnail?(id: string, bytes: Uint8Array): Promise<void>
  libraryObjects?: LibraryObjectStore
}

export type StoragePreferenceField = {
  id: StorageFieldID
  label: string
  kind: 'text' | 'url'
  required?: boolean
  placeholder?: string
}

export type StorageCredentialField = {
  id: StorageFieldID
  label: string
  required?: boolean
  placeholder?: string
}

export type StorageProviderRuntime = {
  preferences: Readonly<Record<StorageFieldID, string>>
  resolveCredential(field: StorageFieldID): Promise<string | null>
}

export type StorageProviderRegistration = {
  id: StorageProviderID
  label: string
  description: string
  preferenceFields: readonly StoragePreferenceField[]
  credentialFields: readonly StorageCredentialField[]
  createAdapter(runtime: StorageProviderRuntime): StorageAdapter
}

export type StorageAdapterContext = {
  preferences: Readonly<Record<StorageFieldID, string>>
  credentials: CredentialResolver
  profileId?: string
}
