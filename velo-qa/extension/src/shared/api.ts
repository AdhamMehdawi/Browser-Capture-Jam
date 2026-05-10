import { API_URL } from './config.js';
import { clearAuth, getAuth } from './storage.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (init.auth !== false) {
    const auth = await getAuth();
    if (auth) headers.set('authorization', `Bearer ${auth.accessToken}`);
  }
  const url = `${API_URL}${path}`;
  console.log(`[velocap/api] ${init.method ?? 'GET'} ${url}`);
  const res = await fetch(url, { ...init, headers });
  console.log(`[velocap/api] ${res.status} ${res.statusText} ← ${path}`);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    console.error(`[velocap/api] Non-JSON response from ${path}:`, text.slice(0, 200));
    // Server returned non-JSON (HTML from Clerk middleware on expired token)
    if (res.status === 401 || res.status === 403) {
      await clearAuth();
      throw new ApiError(res.status, 'session_expired', 'Session expired — please sign in again');
    }
    throw new ApiError(res.status, 'invalid_response', `Server error (${res.status}) — try signing in again`);
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } }).error;
    if (res.status === 401) await clearAuth();
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
  }
  return json as T;
}

export const api = {
  login(email: string, password: string) {
    return request<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      auth: false,
    });
  },
  demoLogin() {
    return request<{ accessToken: string }>('/auth/demo-login', {
      method: 'POST',
      auth: false,
    });
  },
  register(email: string, password: string, name?: string) {
    return request<{ accessToken: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
      auth: false,
    });
  },
  me() {
    return request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        memberships: Array<{ role: string; workspace: { id: string; slug: string; name: string } }>;
      };
    }>('/auth/me');
  },
  /**
   * Verify an API key and get user info.
   * Used for authentication with the dashboard's API key system.
   */
  verifyApiKey(apiKey: string) {
    return request<{ userId: string; email: string | null; name: string | null }>(
      '/auth/verify-api-key',
      {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
        auth: false,
      }
    );
  },
  /**
   * Verify a Clerk JWT token and get user info.
   * Used by the extension to authenticate via Clerk session.
   */
  verifyClerkToken(token: string) {
    return request<{ userId: string; email: string | null; name: string | null }>(
      '/auth/verify-clerk-token',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        auth: false,
      }
    );
  },
  /**
   * Get current user profile using API key auth.
   */
  meWithApiKey() {
    return request<{
      userId: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      totalRecordings: number;
      apiKeyPreview: string | null;
    }>('/me');
  },
  createJam(input: unknown) {
    return request<{ id: string; url: string }>('/jams', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  // --- Streaming upload endpoints ---

  /** Initialize a streaming upload session. Returns a SAS URL for direct-to-Azure block uploads. */
  initUpload(ext: string) {
    return request<{ uploadSasUrl: string; objectPath: string; readSasUrl: string }>('/uploads/init', {
      method: 'POST',
      body: JSON.stringify({ ext }),
    });
  },

  /** Complete a streaming upload. Video bytes are already in Azure — this sends metadata only. */
  completeUpload(metadata: {
    objectPath: string;
    thumbnailObjectPath?: string;
    title?: string;
    trimStartMs?: number;
    trimEndMs?: number;
    durationMs: number;
    page?: { url: string; title: string };
    device?: unknown;
    console?: unknown[];
    network?: unknown[];
    actions?: unknown[];
  }) {
    return request<{ id: string; url: string }>('/uploads/complete', {
      method: 'POST',
      body: JSON.stringify(metadata),
    });
  },

  /** Discard a streaming upload — deletes the blob from Azure. */
  discardUpload(objectPath: string) {
    const encoded = objectPath.replace(/^\//, '');
    return request<void>(`/uploads/${encoded}`, { method: 'DELETE' });
  },
};
