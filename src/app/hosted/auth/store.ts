import { atom } from 'nanostores'
import { fetchCurrentUser, login as apiLogin, logout as apiLogout, type HostedUser } from './api'

export const currentUser = atom<HostedUser | null | undefined>(undefined) // undefined = not checked yet

export async function refreshCurrentUser(): Promise<void> {
  currentUser.set(await fetchCurrentUser())
}

export async function login(email: string, password: string): Promise<void> {
  await apiLogin(email, password)
  await refreshCurrentUser()
}

export async function logout(): Promise<void> {
  await apiLogout()
  currentUser.set(null)
}
