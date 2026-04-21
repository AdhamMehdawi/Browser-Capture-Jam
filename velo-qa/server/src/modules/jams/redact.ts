// FR-S1 — redact sensitive headers + values before persistence.
//
// We never want to store Authorization, Cookie, Set-Cookie verbatim — even
// from a user's own browser — because a Jam permalink can be shared. The
// replacement keeps the first 4 chars so a reviewer can still spot-check that
// a token was *present* without leaking it.

import type { NetworkEntry } from './schemas.js';

const BLOCK_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
]);

const SENSITIVE_SUBSTRINGS = ['key', 'token', 'password', 'secret', 'auth', 'session'];

function redactValue(v: string): string {
  if (!v) return v;
  return `[redacted:${v.slice(0, 4)}…]`;
}

function isSensitive(name: string): boolean {
  const lower = name.toLowerCase();
  if (BLOCK_HEADER_NAMES.has(lower)) return true;
  return SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s));
}

export function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isSensitive(k) ? redactValue(v) : v;
  }
  return out;
}

export function redactNetworkEntry(entry: NetworkEntry): NetworkEntry {
  return {
    ...entry,
    ...(entry.requestHeaders ? { requestHeaders: redactHeaders(entry.requestHeaders) } : {}),
    ...(entry.responseHeaders ? { responseHeaders: redactHeaders(entry.responseHeaders) } : {}),
  };
}
