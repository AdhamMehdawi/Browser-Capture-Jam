import { STORAGE_KEYS } from './config.js';
import type { AuthState } from '../types.js';

export async function getAuth(): Promise<AuthState | null> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.auth);
  const raw = res[STORAGE_KEYS.auth];
  if (!raw || typeof raw !== 'object') return null;
  return raw as AuthState;
}

export async function setAuth(state: AuthState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.auth]: state });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.auth);
}
