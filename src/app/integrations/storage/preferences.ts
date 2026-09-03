import { useLocalStorage } from '@vueuse/core'

import { storageProviderRegistry } from './providers'
import type { StorageFieldID, StorageProviderID } from './types'

export type StoragePreferences = Record<StorageProviderID, Record<StorageFieldID, string>>

// Grandpa's Studio deployment: hosted-server is the only storage that
// makes sense here, so it's the default rather than S3. Still an
// overridable per-browser localStorage value, not hardcoded, in case
// that ever needs to change.
export const activeStorageProviderID = useLocalStorage<StorageProviderID>(
  'open-pencil:storage:provider',
  'hosted-server'
)

const storedPreferences = useLocalStorage<StoragePreferences>('open-pencil:storage:preferences', {})

// Self-heal browsers that cached a provider selection from before this
// deployment defaulted to hosted-server (anyone who visited during
// earlier testing/dev). The `useLocalStorage` default above only applies
// the first time a key is ever written — it doesn't touch a value
// that's already there. If whatever's currently selected was never
// actually configured (true of 's3-compatible' here, since this
// deployment never sets up S3), and hosted-server is registered, switch
// to it. A real, working S3 setup would pass storagePreferencesComplete
// and stay untouched.
if (
  activeStorageProviderID.value !== 'hosted-server' &&
  storageProviderRegistry.list().some((provider) => provider.id === 'hosted-server') &&
  !storagePreferencesComplete(activeStorageProviderID.value)
) {
  activeStorageProviderID.value = 'hosted-server'
}

export function readStoragePreferences(
  providerID: StorageProviderID
): Readonly<Record<StorageFieldID, string>> {
  return { ...storedPreferences.value[providerID] }
}

export function writeStoragePreference(
  providerID: StorageProviderID,
  field: StorageFieldID,
  value: string
): void {
  const provider = storageProviderRegistry.get(providerID)
  if (!provider.preferenceFields.some((definition) => definition.id === field)) {
    throw new Error(`Unknown preference field for ${providerID}: ${field}`)
  }
  storedPreferences.value = {
    ...storedPreferences.value,
    [providerID]: {
      ...storedPreferences.value[providerID],
      [field]: value.trim()
    }
  }
}

export function storagePreferencesComplete(providerID: StorageProviderID): boolean {
  const provider = storageProviderRegistry.get(providerID)
  const preferences = readStoragePreferences(providerID)
  return provider.preferenceFields.every(
    (field) => !field.required || Boolean(preferences[field.id]?.trim())
  )
}
