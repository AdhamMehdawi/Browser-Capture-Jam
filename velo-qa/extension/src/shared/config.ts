// API endpoint is baked at build time so the popup + background + content
// scripts all agree. Override via VITE_API_URL if you deploy the server.
export const API_URL: string =
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  'http://localhost:4000';

export const STORAGE_KEYS = {
  auth: 'veloqa.auth',
  activeWorkspaceId: 'veloqa.activeWorkspaceId',
} as const;
