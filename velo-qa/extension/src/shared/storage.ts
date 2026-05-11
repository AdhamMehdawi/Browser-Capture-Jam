import { STORAGE_KEYS, CURRENT_CONSENT_VERSION } from './config.js';
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

// ── Consent ──────────────────────────────────────────────────
interface ConsentRecord {
  version: string;
  grantedAt: string;
}

/** Returns the consent record if valid (version matches), null otherwise. */
export async function getConsent(): Promise<ConsentRecord | null> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.consentGiven);
  const raw = res[STORAGE_KEYS.consentGiven];
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as ConsentRecord;
  if (record.version !== CURRENT_CONSENT_VERSION) return null;
  return record;
}

/** Store consent with current version and timestamp. */
export async function setConsent(): Promise<void> {
  const record: ConsentRecord = {
    version: CURRENT_CONSENT_VERSION,
    grantedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.consentGiven]: record });
}
