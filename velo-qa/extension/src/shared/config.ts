// API endpoint is baked at build time so the popup + background + content
// scripts all agree. Override via VITE_API_URL if you deploy the server.
export const API_URL: string =
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  'http://localhost:4000/api';

// Dashboard URL for Clerk authentication
export const DASHBOARD_URL: string =
  (import.meta as unknown as { env?: { VITE_DASHBOARD_URL?: string } }).env?.VITE_DASHBOARD_URL ??
  'http://localhost:3001';

export const STORAGE_KEYS = {
  auth: 'velocap.auth',
  activeWorkspaceId: 'velocap.activeWorkspaceId',
  consentGiven: 'velocap.consentGiven',
  /**
   * Feature #12 follow-up: opt-in capture of JSON/text response bodies so
   * HAR exports show the actual payload. Off by default — bodies-on can
   * disturb streaming sites (see Issue 13). Boolean.
   */
  captureResponseBodies: 'velocap.captureResponseBodies',
} as const;

/** Bump this when the privacy policy changes materially to re-trigger consent. */
export const CURRENT_CONSENT_VERSION = 'v1';
