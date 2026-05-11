# VeloCap — Encryption & GDPR Compliance Handover

**Date**: 2026-05-11
**Author**: Tareq Tbakhi
**Status**: Implemented, pending deployment to production

---

## Overview

VeloCap captures screen recordings, console logs, network requests (with headers and bodies), and user interactions from a Chrome extension. This data can contain sensitive information: Authorization headers with bearer tokens, cookies, passwords in request bodies, API keys, and PII.

We implemented a 5-layer GDPR compliance system:

1. **Browser-side data sanitization** — redact sensitive data before it leaves the browser
2. **Server-side AES-256-GCM encryption at rest** — encrypt the events column in PostgreSQL
3. **GDPR API endpoints** — right to erasure (`DELETE /me`) and data export (`GET /me/export`)
4. **First-run consent flow** — GDPR Article 7 consent before the extension captures anything
5. **Privacy policy page** — publicly accessible at `/privacy`

---

## 1. Browser-Side Data Sanitization

### File: `velo-qa/extension/src/content/sanitize.ts`

This is the first line of defense. It runs in the browser's MAIN world (injected by the content script) and sanitizes all captured data **before** it's sent to the server.

Three exported functions:

| Function | What it does |
|----------|-------------|
| `sanitizeHeaders(headers)` | Replaces values of 9 sensitive header names with `[REDACTED]` |
| `sanitizeBody(body)` | Two-tier body redaction (see below) |
| `sanitizeConsoleMessage(msg)` | Regex-based token scrubbing for console strings |

#### Header Redaction

These header names have their **values** replaced with `[REDACTED]`:
`authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `proxy-authorization`, `www-authenticate`, `x-csrf-token`, `x-xsrf-token`

#### Body Redaction — Two-Tier Approach

**Tier 1 (structured, bodies <= 10KB)**:
- **JSON bodies**: Parses the JSON, recursively walks the object tree, redacts **values** (not keys) for sensitive field names: `password`, `passwd`, `secret`, `token`, `accessToken`, `refreshToken`, `apiKey`, `api_key`, `authorization`, `credit_card`, `cardNumber`, `cvv`, `ssn`, `access_token`, `refresh_token`
- **URL-encoded bodies**: Parses with `URLSearchParams`, redacts same field names

**Tier 2 (unstructured, or bodies > 10KB)**:
- Applies high-confidence regex patterns only:
  - JWT tokens (`eyJ...` three-segment pattern)
  - Bearer tokens
  - Stripe secret keys (`sk_live_*`, `sk_test_*`)
  - AWS access keys (`AKIA*`)

#### Integration Points in `page-hook.ts`

The sanitizers are applied at 8 injection points:

| Location | What's sanitized |
|----------|-----------------|
| Fetch request headers | `sanitizeHeaders()` |
| Fetch request body | `sanitizeBody()` |
| Fetch response headers | `sanitizeHeaders()` |
| Fetch response body | `sanitizeBody()` |
| XHR request headers + body | `sanitizeHeaders()` + `sanitizeBody()` |
| XHR response headers + body | `sanitizeHeaders()` + `sanitizeBody()` |
| Console capture (`console.log/warn/error`) | `sanitizeConsoleMessage()` |
| Error + unhandled rejection handlers | `sanitizeConsoleMessage()` |

---

## 2. AES-256-GCM Encryption at Rest

### File: `artifacts/api-server/src/lib/encryption.ts`

The `events` column in the `recordings` table stores all DevTools data (console logs, network requests, user actions). This module encrypts it at rest using AES-256-GCM.

### How It Works

```
Write path:  JSON array  →  JSON.stringify  →  AES-256-GCM encrypt  →  "v1:base64(iv + authTag + ciphertext)"
Read path:   "v1:base64(...)"  →  base64 decode  →  split iv/authTag/ciphertext  →  AES-256-GCM decrypt  →  JSON.parse  →  array
```

### Stored Format

The encrypted value stored in the `events` column is a string:

```
v1:SGVsbG8gV29ybGQ...base64...
```

- `v1` — the key version used for encryption
- `:` — separator
- Everything after — base64-encoded binary: `12-byte IV` + `16-byte auth tag` + `ciphertext`

### Exported Functions

| Function | Purpose |
|----------|---------|
| `encryptEvents(events)` | Encrypts a JSON-serializable value. Returns `"v{N}:base64(...)"` |
| `decryptEvents(encoded)` | Decrypts a versioned string back to the original value |
| `isEncrypted(value)` | Returns `true` if the value is a versioned encrypted string (`typeof string && /^v\d+:/.test()`) |
| `decryptEventsIfNeeded(value)` | Safe wrapper — decrypts if encrypted, passes through if legacy JSON array |

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `EVENTS_ENCRYPTION_KEY_V1` | The actual AES-256 key (32 bytes as 64-char hex) | `a1b2c3...` (64 hex chars) |
| `EVENTS_ENCRYPTION_KEY_CURRENT` | Which key version to use for **new writes** | `v1` |

**Generate a key**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Key Rotation

The system supports key rotation without downtime:

1. Generate a new key, set it as `EVENTS_ENCRYPTION_KEY_V2`
2. Change `EVENTS_ENCRYPTION_KEY_CURRENT` to `v2`
3. New recordings are encrypted with v2
4. Old recordings still have `v1:` prefix and decrypt using `EVENTS_ENCRYPTION_KEY_V1`
5. Both keys must remain in environment variables until all v1 data is re-encrypted or deleted

### Where Encryption/Decryption Happens

| File | Operation | Details |
|------|-----------|---------|
| `routes/uploads.ts` line 135 | **Encrypt** | `encryptEvents(events)` before `db.insert()`. Conditional: only encrypts if `EVENTS_ENCRYPTION_KEY_V1` is set (dev environments without the key store plaintext) |
| `routes/recordings.ts` | **Decrypt** | `decryptEventsIfNeeded(recording.events)` in `GET /recordings/:id` |
| `routes/share.ts` line 56 | **Decrypt + Strip** | `stripBodiesForShare(decryptEventsIfNeeded(recording.events))` — also removes `requestBody`/`responseBody` from shared links |
| `routes/user.ts` line 190 | **Decrypt** | `decryptEventsIfNeeded(r.events)` in `GET /me/export` (data portability) |

### Backward Compatibility

Legacy recordings stored before encryption was enabled have a JSON array in the `events` column (not a string). The `isEncrypted()` check (`typeof value === 'string'`) ensures these are passed through without attempting decryption. No migration needed.

---

## 3. GDPR API Endpoints

### File: `artifacts/api-server/src/routes/user.ts`

#### `DELETE /me` — Right to Erasure (GDPR Article 17)

Permanently deletes all user data. Order of operations:

1. Fetch all recording rows to collect blob paths (video, thumbnail, trimmedVideo)
2. Delete all recordings from PostgreSQL
3. Delete user row from PostgreSQL
4. Best-effort: delete Azure blobs (`.catch(() => {})` — orphaned blobs are harmless since DB linkage is gone)
5. Best-effort: delete Clerk user account

Returns `204 No Content` on success.

#### `GET /me/export` — Right to Data Portability (GDPR Article 20)

Exports all user data as a JSON file download. Streams the response in batches of 50 recordings to prevent OOM on large accounts.

Response format:
```json
{
  "exportedAt": "2026-05-11T...",
  "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "..." },
  "recordings": [
    { "id": "...", "title": "...", "events": [...decrypted...], ... }
  ]
}
```

Events are decrypted using `decryptEventsIfNeeded()` so the export contains readable data.

### Dashboard UI: `artifacts/snapcap-dashboard/src/pages/settings.tsx`

The Settings page has a "Data & Privacy" card with:
- **"Export My Data"** button — calls `GET /api/me/export`, triggers browser file download
- **"Delete My Account"** button — double confirmation dialog, calls `DELETE /api/me`, redirects to sign-out

---

## 4. Shared Recording Security

### File: `artifacts/api-server/src/routes/share.ts`

The `stripBodiesForShare()` function removes `requestBody` and `responseBody` from all network events before sending to the public share endpoint. This prevents business-sensitive data from leaking through share links, even after header redaction.

Shared recordings still include: method, URL, status code, headers (redacted at capture time), and timing data — enough for debugging context.

---

## 5. First-Run Consent Flow

### Files:
- `velo-qa/extension/src/consent/index.html` + `index.ts` — Consent page
- `velo-qa/extension/src/shared/config.ts` — `STORAGE_KEYS.consentGiven`, `CURRENT_CONSENT_VERSION`
- `velo-qa/extension/src/shared/storage.ts` — `getConsent()`, `setConsent()`
- `velo-qa/extension/src/background/index.ts` — `chrome.runtime.onInstalled` listener
- `velo-qa/extension/src/popup/App.tsx` — Consent gate before auth check

### Flow:
1. On fresh install or update with version mismatch → consent page tab opens automatically
2. Popup checks `getConsent()` before allowing any action — if null, opens consent page
3. User must click "I Agree" before the extension works
4. Consent stored in `chrome.storage.local` with version + timestamp
5. Version mismatch detection: if `CURRENT_CONSENT_VERSION` changes (e.g., `v1` → `v2`), existing users re-consent on next extension update

---

## 6. Privacy Policy

### File: `artifacts/snapcap-dashboard/src/pages/privacy.tsx`

Publicly accessible at `/privacy` (no auth required). Route defined in `App.tsx` outside of `ProtectedRoute`. Footer link on the home page points to `/privacy`.

---

## Deployment Checklist

### API Server (Azure Container App)

1. Generate the encryption key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Set environment variables on the Container App:
   ```bash
   az containerapp update \
     --name velocap-api-dev \
     --resource-group velocap-rg-dev \
     --set-env-vars \
       EVENTS_ENCRYPTION_KEY_V1=<the-64-char-hex-key> \
       EVENTS_ENCRYPTION_KEY_CURRENT=v1
   ```

3. Redeploy the API server with the latest code

4. Verify: create a recording, then query the DB directly:
   ```sql
   SELECT events FROM recordings ORDER BY created_at DESC LIMIT 1;
   ```
   Should show a string starting with `v1:`, not a JSON array.

### Dashboard (Azure Static Web App)

Rebuild and deploy — no new env vars needed. The privacy page and settings UI are frontend-only.

### Chrome Extension

Rebuild and upload to Chrome Web Store. The sanitization and consent flow are bundled into the extension.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                 Chrome Extension                 │
│                                                  │
│  page-hook.ts captures data                      │
│       │                                          │
│       ▼                                          │
│  sanitize.ts  ← redacts headers, bodies, tokens  │
│       │                                          │
│       ▼                                          │
│  Already-sanitized data sent to API server        │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│                  API Server                       │
│                                                   │
│  POST /uploads/complete                           │
│       │                                           │
│       ▼                                           │
│  encryption.ts  ← AES-256-GCM encrypt events      │
│       │                                           │
│       ▼                                           │
│  PostgreSQL  (events column = "v1:base64...")      │
│                                                   │
│  GET /recordings/:id  → decrypt → return JSON     │
│  GET /share/:token    → decrypt → strip bodies    │
│  GET /me/export       → decrypt → stream JSON     │
│  DELETE /me           → delete DB + blobs + Clerk  │
└──────────────────────────────────────────────────┘
```

---

## Key Design Decisions

1. **Sanitize in the browser, not the server** — Sensitive data never leaves the user's machine. Even if the server is compromised, captured data is already redacted.

2. **Conditional encryption** — `encryptEvents()` only runs if `EVENTS_ENCRYPTION_KEY_V1` is set. Dev environments without the key store plaintext, avoiding setup friction.

3. **Versioned keys** — The `v{N}:` prefix on encrypted strings enables key rotation without migrating existing data.

4. **`isEncrypted()` guard** — Simple type check (`typeof string` vs JSON array) handles the transition from unencrypted to encrypted storage with zero migration scripts.

5. **Strip bodies on share** — Even after header redaction, request/response bodies in shared recordings could contain sensitive business data. The share endpoint removes them entirely.

6. **Streamed export** — `GET /me/export` uses `res.write()` in batches of 50 to avoid loading all recordings into memory at once.

7. **DB-first deletion** — `DELETE /me` removes DB rows first (the linkage), then best-effort deletes blobs. Orphaned blobs without DB references are harmless and can be cleaned up by Azure lifecycle policies.
