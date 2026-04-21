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
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
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
};
