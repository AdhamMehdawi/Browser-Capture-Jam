# Velo QA Changelog

Append-only log of meaningful changes. Newest entries at the top.

## 2026-04-20

### Phase 3 — MV3 extension (screenshot + context)
- `extension/` now builds a loadable Chrome extension in `extension/dist/`.
- MV3 manifest via `@crxjs/vite-plugin`. Permissions: `activeTab`, `scripting`, `storage`, `tabs`. Host permissions: `<all_urls>` + API.
- **Popup** (React): email/password login or register → workspace picker → "Capture this page" button → shows Jam URL with copy + open actions.
- **Background SW:** `chrome.tabs.captureVisibleTab` for screenshot + coordinates content-script context fetch + uploads the envelope to `/jams`.
- **Content script (isolated world):** injects a MAIN-world hook via `web_accessible_resources`, buffers events, answers `capture-context` with console + network + device + page info.
- **MAIN-world hook:** patches `console.{log,info,warn,error,debug}`, `window.onerror`, `unhandledrejection`, `window.fetch`, `XMLHttpRequest`. Forwards events via `window.postMessage`.
- Placeholder pink (`#ff4d7e`) PNG icons generated in pure Python at 16/48/128.

### Phase 2 — Jam ingest API + permalink viewer
- Prisma migration `add_jams` — `Jam` (workspace-scoped, enum `JamType` / `JamVisibility`, JSON columns for console/network/actions, durationMs, page + device) and `JamAsset` (Bytes column, inlined media for MVP).
- `POST /jams` (20 MB body limit), `GET /jams`, `GET /jams/:id`, `GET /jams/assets/:id` (streams the asset bytes with correct content-type), and `GET /j/:id` — a self-contained HTML viewer with a DevTools-style Console / Network / Device tab panel.
- **Redaction (FR-S1)** applied at write time: `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, `X-API-Key`, `X-Auth-Token`, plus any header whose name contains key/token/password/secret/auth/session → `[redacted:first4…]`. Verified end-to-end via curl.
- CORS updated to accept `chrome-extension://` and `moz-extension://` origins alongside the web dashboard.

### Live end-to-end test (server up against Postgres + MinIO)
- `pnpm install` clean (266 pkgs, argon2 native build OK).
- Remapped Docker Postgres to host port **5433** (native Postgres occupied 5432); updated `docker-compose.yml` and `.env.example`.
- Switched dev script to `tsx watch --env-file=.env` so env loads without a dotenv dep.
- Cookie fix: `Domain=localhost` is rejected by browsers and curl; `setRefreshCookie` now omits `Domain` when `COOKIE_DOMAIN=localhost`, yielding a host-only cookie.
- Verified flow: register → `/auth/me` → create workspace → list → invite → refresh → refresh → **replay stale refresh** returns `refresh_replay` and nukes the family → bad password rejected → unauth rejected → email verify marks `emailVerifiedAt`. Dev mailer logged both verify and invite links to stdout.

### Phase 1.4 — Workspaces + roles + invites (FR-A2)
- `server/src/modules/workspaces/` — service + routes for workspace CRUD, member role updates, removal, and invite lifecycle (create, accept, list, revoke).
- Role-rank-based authorization helper (`canAssignRole`) — actors can only assign roles strictly below their own; only OWNERs handle ownership (explicit transfer path to come).
- Invite tokens are 32-byte opaque strings, SHA-256 hashed at rest, 7-day TTL, delivered via the dev mailer to stdout.

### Phase 1.2 + 1.3 — Email/password auth, JWT + refresh rotation (FR-A1)
- `server/src/modules/auth/` — register, login, refresh, logout, verify-email, request-verification, and `/auth/me`.
- argon2id password hashing (OWASP 2024 params) in `lib/password.ts`.
- Access JWT (HS256, 15m) signed per request; refresh tokens opaque, SHA-256 hashed at rest, rotated on every `/auth/refresh` with replay detection that revokes the whole family (see ASSUMPTIONS A9).
- Refresh cookie is httpOnly, `sameSite=lax`, scoped to `/auth`, secure in production.
- Registration auto-creates a personal workspace with the user as OWNER (see ASSUMPTIONS A10).
- Login route rate-limited (10/min) on top of global default.
- `request-verification` silently no-ops for unknown emails to avoid account enumeration.

### Phase 1.1 — Fastify server + Prisma schema
- `server/prisma/schema.prisma` with User, Workspace, Membership, Invite, RefreshToken, ApiKey, EmailVerification + Role/InviteStatus enums.
- Fastify app with helmet, CORS, cookie, and rate-limit plugins; zod-validated env loader; pino logger with header redaction; Prisma singleton; typed HttpError class and error-handler plugin.
- Auth plugin decorates `req.userId` / `req.userEmail` and exposes `app.requireAuth`.

### Phase 0 — Repo scaffold
- Monorepo root: `package.json` (pnpm workspaces), `pnpm-workspace.yaml`, `tsconfig.base.json`, `.prettierrc.json`, `.editorconfig`, `.nvmrc` (Node 20), `.gitignore`, `.env.example`, `README.md`, `docker-compose.yml` (Postgres 16 + MinIO with auto-bucket).
- `server/`, `web/`, `extension/` workspaces with `package.json`, `README.md`, `tsconfig.json` stubs.
- Seeded `docs/FRD.md`, `docs/ASSUMPTIONS.md` (A1–A10), `tracker/TRACKER.md`, `tracker/CHANGELOG.md`.

> Packages intentionally **not installed** yet — scaffold is code-and-config only per instruction.
