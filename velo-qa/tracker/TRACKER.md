# Velo QA Build Tracker

Living status of build phases against the FRD. Update after each meaningful change.

**Legend:** ⬜ not started · 🟨 in progress · ✅ done · ⏸ deferred

---

## Phase 0 — Repo setup ✅
- ✅ Monorepo scaffold (pnpm workspaces, TS, Prettier, EditorConfig)
- ✅ Folders: `extension/`, `web/`, `server/` (with package.json + README + tsconfig stubs)
- ✅ Root docs (`README.md`, `docs/FRD.md`, `docs/ASSUMPTIONS.md`)
- ✅ Tracker (`tracker/TRACKER.md`, `tracker/CHANGELOG.md`)
- ✅ `.env.example`, `.gitignore`, `.nvmrc`, `.prettierrc.json`, `tsconfig.base.json`
- ✅ `docker-compose.yml` (Postgres + MinIO + bucket init)

## Phase 1 — Backend auth
- ✅ **1.1** Fastify server bootstrap + Prisma schema (User, Workspace, Membership, Invite, RefreshToken, ApiKey, EmailVerification)
- ✅ **1.2** Email/password register + verify + login (argon2id) — FR-A1
- ✅ **1.3** JWT access (15m) + refresh cookie (30d) w/ rotation + replay detection — FR-A1
- ✅ **1.4** Workspaces + roles (OWNER/ADMIN/MEMBER/VIEWER) + email invites — FR-A2
- ⬜ **1.5** Google OAuth — FR-A1 (deferred within Phase 1)
- ⬜ **1.6** API keys — FR-A3

## Phase 2 — Jam ingest API
- ⏸ **2.1** Pre-signed PUT endpoint (FR-U2) — deferred; media inlined in Postgres for MVP
- ✅ **2.2** `POST /jams` envelope (FR-U1)
- ✅ **2.3** Server-side redaction pipeline (FR-S1)
- ✅ **2.4** Permalink + visibility (FR-D7) — `/j/:id`, `PUBLIC` | `WORKSPACE`
- ⬜ **2.5** Retention cron (FR-S4)

## Phase 3 — Extension capture engine
- ✅ **3.1** MV3 skeleton + popup UI (login + workspace picker + capture)
- ✅ **3.2** Screenshot (FR-C1) — `chrome.tabs.captureVisibleTab`
- ⬜ **3.3** Video capture (FR-C2)
- ✅ **3.4** Console capture (FR-X1) — MAIN-world hook on `console.*`, `onerror`, `unhandledrejection`
- ✅ **3.5** Network capture (FR-X2) — MAIN-world hook on `fetch` + `XMLHttpRequest` (CDP upgrade later)
- ✅ **3.6** Device metadata (FR-X4) — UA / screen / DPR / viewport / language / timezone / color scheme
- ⬜ **3.7** Input masking (FR-S2) — predicate written, not yet wired (we don't snapshot inputs in MVP)
- ⬜ **3.8** Annotation editor (FR-C6)
- ✅ **3.9** Upload pipeline (FR-U3) — POST w/ retry surfaced via error in popup

## Phase 4 — Dashboard
- ⬜ **4.1** App shell + auth pages
- ⬜ **4.2** Jam list (FR-D6)
- ⬜ **4.3** `/j/:id` viewer (FR-D1)
- ⬜ **4.4** Console tab (FR-D4)
- ⬜ **4.5** Network tab + cURL (FR-D3)
- ⬜ **4.6** Video ↔ log sync (FR-D2)
- ⬜ **4.7** Permalink + share (FR-D7)

## Phase 5 — NFR / QA
- ⬜ Unit tests on recorders (NFR-7)
- ⬜ Playwright e2e capture → upload → view
- ⬜ Structured JSON logs + Sentry
- ⬜ WCAG AA pass

---

## Next up
1. Phase 3.3 — video recording (`chrome.tabCapture` + `MediaRecorder`) + upload as `video/webm`.
2. Phase 2.1 — move media to MinIO via pre-signed PUT so we stop inlining bytes in Postgres.
3. Phase 4.1 — Next.js dashboard to replace the inline HTML viewer.
4. Phase 3.8 — canvas annotation editor on the screenshot before upload.
