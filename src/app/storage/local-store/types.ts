import type { StorageProviderID } from '@/app/integrations/storage/types'

export type LocalSyncStatus = 'synced' | 'pending' | 'error' | 'conflict'

/** Metadata for a stored canvas cached on device (document bytes stored separately). */
export type LocalCanvasMeta = {
  id: string
  providerId: StorageProviderID
  name: string
  updatedAt: string
  /** Monotonic local revision; increments on each local write. */
  revision: number
  syncStatus: LocalSyncStatus
  lastSyncedAt: string | null
  lastSyncError: string | null
  /** Soft-deleted; hidden from UI until remote delete completes. */
  tombstoned: boolean
  hasFig: boolean
  hasThumb: boolean
  /** Size of the cached fig blob in bytes (set on write; backfilled by eviction). */
  figSize?: number
  /** Last time this canvas was opened on this device (LRU eviction key). */
  lastOpenedAt?: string
}

/** Index-only row for remote canvases not yet downloaded (no fig body). */
export type LocalCanvasIndexInput = Omit<
  LocalCanvasMeta,
  'hasFig' | 'hasThumb' | 'tombstoned' | 'revision'
> & {
  revision?: number
  hasFig?: boolean
  hasThumb?: boolean
}

export type LocalCanvasWriteInput = {
  id: string
  providerId: StorageProviderID
  name: string
  updatedAt?: string
  /**
   * A Blob is preferred for anything large. IndexedDB stores Blobs by
   * reference and can back them with disk, whereas a Uint8Array is
   * structured-cloned into memory on every write — a full document-size
   * allocation each time a document is cached.
   */
  figBytes: Uint8Array | Blob
  thumbBytes?: Uint8Array | null
  /** If set, keep this revision; otherwise increment from existing. */
  revision?: number
  syncStatus?: LocalSyncStatus
}
