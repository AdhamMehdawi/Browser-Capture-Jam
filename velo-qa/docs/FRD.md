# Functional Requirements Document — Velo QA

**Project:** Velo QA — an open-source clone of jam.dev
**Owner:** Adham Mehdawi
**Document version:** 1.0
**Date:** 2026-04-20
**Intended reader:** Claude Code (development agent) — build from this document.

---

## 1. Product vision

Velo QA is a one-click bug capture tool. A developer, QA engineer, or PM presses a button in their browser and Velo QA packages up everything a receiving engineer needs to reproduce the bug: a screenshot or screen recording, the browser console log, all network activity, the page URL, and the user's device and browser metadata. The capture is uploaded to a server and turned into a permalink that can be pasted into Jira, Linear, GitHub, or Slack. The recipient clicks the link and sees the full reproduction context in a web dashboard.

The north star: **"the time from 'I found a bug' to 'engineer has everything they need to fix it' should be under 30 seconds."**

---

## 2. Personas

- **Reporter** — anyone who hits a bug (QA, PM, customer-success, internal employee). Uses the browser extension.
- **Fixer** — the engineer who receives the Jam link, opens the dashboard, and investigates.
- **Admin** — workspace owner who manages members, integrations, and retention settings.

---

## 3. High-level architecture

Three deliverables, in one repo:

| Component | Folder | Stack |
|---|---|---|
| Browser extension (MV3) | `extension/` | TypeScript, Vite, React, WebExtension APIs |
| Web dashboard | `web/` | Next.js 14 (App Router), TypeScript, Tailwind, shadcn/ui |
| Backend API | `server/` | Node.js + Fastify, TypeScript, PostgreSQL (Prisma), S3-compatible storage (MinIO in dev) |

---

## 4. Functional requirements

### 4.1 Capture engine (extension)
- **FR-C1** Screenshot of visible tab — `chrome.tabs.captureVisibleTab`, PNG at device pixel ratio.
- **FR-C2** Video capture — `chrome.tabCapture` + `MediaRecorder`, WebM (VP9+Opus), up to 5 min, pause/resume/stop.
- **FR-C3** Instant Replay — rolling 60 s in-memory buffer, save-on-demand.
- **FR-C4** Webcam overlay (optional PiP).
- **FR-C5** Microphone capture (optional).
- **FR-C6** Annotation editor — canvas with arrows, rectangles, freehand, text, blur; save flattened PNG + editable JSON layer.
- **FR-C7** Area-select for partial screenshots.

### 4.2 Context recorder (extension)
- **FR-X1** Console capture — log/info/warn/error/debug, `window.onerror`, `onunhandledrejection`, full stacks + timestamps.
- **FR-X2** Network capture — `chrome.debugger` + CDP Network domain; URL, method, headers, bodies (1 MB trunc, 10 MB max), timing, initiator.
- **FR-X3** DOM snapshot — full HTML + viewport + scroll at capture time.
- **FR-X4** Device/browser metadata — UA parsed, screen, DPR, viewport, color scheme, language, timezone, URL, title, referrer.
- **FR-X5** User action trail — last 25 clicks/inputs/navigations/scrolls (input values masked).
- **FR-X6** Storage snapshot — localStorage + sessionStorage keys/values, sensitive-pattern keys redacted.
- **FR-X7** Source map resolution server-side.

### 4.3 Upload + packaging
- **FR-U1** Jam envelope format (JSON with: id, type, createdAt, capturedBy, page, device, actions, console, network, storage, annotations, media).
- **FR-U2** Pre-signed PUT to object storage, then POST envelope to `/jams`.
- **FR-U3** Progress indicator + exponential-backoff retry.

### 4.4 Dashboard (web)
- **FR-D1** `/j/:id` viewer — media left, DevTools-style tabs right (Console/Network/Actions/Device/Storage).
- **FR-D2** Video playback syncs console + network scroll position; timeline markers for errors/failed requests.
- **FR-D3** Network detail — headers, pretty body, timing waterfall, copy-as-cURL.
- **FR-D4** Console detail — expandable tree, level filter, text search.
- **FR-D5** Threaded comments with resolve.
- **FR-D6** Jam list with filters (type/author/integration/date/search).
- **FR-D7** Per-Jam permalink with visibility toggle.

### 4.5 Auth + workspaces
- **FR-A1** Email+password (argon2id) + Google OAuth; 15-min JWT, 30-day refresh httpOnly cookie; email verify.
- **FR-A2** Workspaces with roles owner/admin/member/viewer; email invites.
- **FR-A3** API keys shown once, hashed at rest.

### 4.6 Integrations (MVP: Slack + Linear)
- **FR-I1** Slack OAuth + channel forwarding with rich unfurl.
- **FR-I2** Linear OAuth + "Create Issue" from Jam.
- **FR-I3** Generic `jam.created` webhook with HMAC.

### 4.7 Privacy + security
- **FR-S1** Redact Authorization/Cookie/Set-Cookie + any header/value containing key/token/password/secret/auth/session → `[redacted:first4…]`.
- **FR-S2** Input masking for password/email/cc/data-jam-mask.
- **FR-S3** Workspace domain allow/denylist for capture.
- **FR-S4** 90-day retention (admin-configurable), hard delete + blob cascade.
- **FR-S5** HTTPS only; signed URLs single-use, 5-min expiry.

---

## 5. Non-functional requirements
- NFR-1 Dashboard TTI < 2.5 s on a 10 MB Jam.
- NFR-2 Extension CPU ≤ 1% idle, ≤ 15% recording.
- NFR-3 MVP scale: 1000 users × 50 captures/mo; p95 upload ≤ 10 s for 2-min video on 20 Mbps.
- NFR-4 Chrome/Edge/Brave/Arc; Firefox post-MVP.
- NFR-5 WCAG 2.1 AA on dashboard; keyboard-navigable popup.
- NFR-6 Structured JSON logs, OpenTelemetry, Sentry.
- NFR-7 Unit tests on recorders; Playwright e2e capture→upload→view; contract tests per API route.

---

## 6. MVP scope
Ship: FR-C1, C2, C6, C7; FR-X1, X2, X4; FR-U1, U2, U3; FR-D1, D2, D3, D4, D6, D7; FR-A1, A2 simplified; FR-S1, S2, S4.
Defer to v1.1: FR-C3 (Instant Replay), D5 (comments), I1–3 (integrations), C4/C5 (webcam/mic), X5/X6/X7 (actions/storage/sourcemaps).
Defer to v2: AI summary/root-cause, mobile SDK, Firefox, SAML/SSO/SCIM.

---

## 7. Acceptance criteria (MVP)
1. Extension captures screenshot in ≤ 3 clicks.
2. Captured Jam shows console errors from source page.
3. Network tab shows method/URL/status/body for XHR + fetch.
4. Video Jam plays and timeline marks a console error at the right timestamp.
5. Permalink shared with a second account shows same content (permission respected).
6. Delete → all blobs gone from object storage within 5 min.
7. Authorization + Cookie headers never appear in stored records.
8. Playwright e2e suite has one green run on CI.

---

## 8. Out of scope
Desktop/native-mobile recording, real-time co-watching, on-prem, billing.

---

## 9. Open questions
1. Hosting: self-hosted docker-compose vs Vercel+Railway+S3?
2. Offline queue in MVP or v1.1?
3. Webcam compositing: server ffmpeg vs client-side WebM?

Log each decision in `docs/ASSUMPTIONS.md` as you proceed.
