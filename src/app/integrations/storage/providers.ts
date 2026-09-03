import { defineStorageProvider, StorageProviderRegistry } from './registry'
import { createS3StorageAdapter } from './s3/adapter'
import { createHostedStorageAdapter } from './hosted/adapter'

export const S3_STORAGE_PROVIDER = defineStorageProvider({
  id: 's3-compatible',
  label: 'S3 storage',
  description: 'AWS S3, Backblaze B2, Cloudflare R2, MinIO, and compatible storage',
  preferenceFields: [
    { id: 'endpoint', label: 'Endpoint', kind: 'url', required: true },
    { id: 'bucket', label: 'Bucket', kind: 'text', required: true },
    { id: 'region', label: 'Region', kind: 'text' }
  ],
  credentialFields: [
    { id: 'access-key-id', label: 'Access key ID', required: true },
    { id: 'secret-access-key', label: 'Secret access key', required: true }
  ],
  createAdapter: createS3StorageAdapter
})

// Auth is a same-origin session cookie (see app/hosted/auth) — no fields
// for the user to fill in, unlike S3.
export const HOSTED_STORAGE_PROVIDER = defineStorageProvider({
  id: 'hosted-server',
  label: "Grandpa's Studio",
  description: "Your team's hosted storage.",
  preferenceFields: [],
  credentialFields: [],
  createAdapter: createHostedStorageAdapter
})

// S3 deliberately isn't registered here — this deployment's storage is
// hosted-server, full stop. S3_STORAGE_PROVIDER stays exported above
// (upstream code) but registering it would make it choosable from
// Settings, which is exactly what shouldn't be possible on this
// deployment.
export const storageProviderRegistry = new StorageProviderRegistry([HOSTED_STORAGE_PROVIDER])
