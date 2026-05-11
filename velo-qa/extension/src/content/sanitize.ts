/**
 * GDPR Data Sanitization — runs in MAIN world before data leaves the browser.
 *
 * Three layers:
 *   1. sanitizeHeaders  — redact values for auth-related HTTP headers
 *   2. sanitizeBody     — redact sensitive fields in JSON / URL-encoded bodies + high-confidence token patterns
 *   3. sanitizeConsoleMessage — scrub tokens from console log strings
 */

// ---------------------------------------------------------------------------
// Header sanitization
// ---------------------------------------------------------------------------

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
  'www-authenticate',
  'x-csrf-token',
  'x-xsrf-token',
]);

/** Replace values of sensitive HTTP headers with [REDACTED]. */
export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Body sanitization
// ---------------------------------------------------------------------------

/** Field names whose *values* should be redacted in structured bodies. */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'api_key',
  'authorization',
  'credit_card',
  'cardnumber',
  'cvv',
  'ssn',
  'access_token',
  'refresh_token',
]);

/** Walk a parsed JSON value and redact values of sensitive keys. */
function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(k.toLowerCase()) && typeof v === 'string') {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        out[k] = redactObject(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return obj;
}

// High-confidence regex patterns for Tier 2 (non-JSON / console strings)
const TOKEN_PATTERNS: RegExp[] = [
  // JWT — three base64url segments separated by dots
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // Bearer tokens (in free text, not headers)
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // Stripe secret keys
  /sk_(?:live|test)_[A-Za-z0-9]{20,}/g,
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
];

/** Max body length for Tier 1 (JSON parse). Larger bodies use Tier 2 only. */
const JSON_PARSE_LIMIT = 10_000;

/**
 * Sanitize a request or response body string.
 *
 * Tier 1 (JSON / URL-encoded): structured field-level redaction.
 * Tier 2 (fallback): high-confidence regex patterns only.
 */
export function sanitizeBody(body: string | undefined): string | undefined {
  if (!body) return body;

  // --- Tier 1: structured redaction ---
  if (body.length <= JSON_PARSE_LIMIT) {
    // Try JSON
    const trimmed = body.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(body);
        const redacted = redactObject(parsed);
        return JSON.stringify(redacted);
      } catch {
        // not valid JSON — fall through
      }
    }

    // Try URL-encoded (key=value&key=value)
    if (body.includes('=') && !body.includes('<')) {
      try {
        const params = new URLSearchParams(body);
        let changed = false;
        for (const [k] of params) {
          if (SENSITIVE_FIELDS.has(k.toLowerCase())) {
            params.set(k, '[REDACTED]');
            changed = true;
          }
        }
        if (changed) return params.toString();
      } catch {
        // not valid URL-encoded
      }
    }
  }

  // --- Tier 2: high-confidence regex ---
  return applyTokenPatterns(body);
}

/** Apply high-confidence token regex patterns to a string. */
function applyTokenPatterns(s: string): string {
  let result = s;
  for (const pat of TOKEN_PATTERNS) {
    // Reset lastIndex for global regexes
    pat.lastIndex = 0;
    result = result.replace(pat, '[REDACTED]');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Console message sanitization
// ---------------------------------------------------------------------------

/** Scrub high-confidence token patterns from a console log message. */
export function sanitizeConsoleMessage(message: string): string {
  return applyTokenPatterns(message);
}
