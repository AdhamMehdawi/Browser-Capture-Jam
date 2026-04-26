# VeloCap — Backend Migration Plan

**Goal:** Replace the currently-deployed backend (`artifacts/api-server`, Express + Clerk + Drizzle) with `velo-qa/server` (Fastify + self-hosted JWT + Prisma), as specified in the team's Summary Table.

**Status:** Plan stage — not yet started. Last updated 2026-04-26.

---

## 1. Why we're doing this

The team's Summary Table specifies `velo-qa/server` as the backend. The currently-deployed backend (`artifacts/api-server`) was chosen earlier in the project because it had a working dashboard wired to it — but that's a tactical decision, not the strategic intent. The Summary Table is the strategic intent. This plan brings code and intent back into alignment.

## 2. Guiding principles

We're applying **SOLID** beyond just code — to the migration process itself:

| Principle | How we apply it here |
|---|---|
| **Single Responsibility** | Each phase has exactly one goal. We do not mix backend infrastructure work with dashboard refactoring. |
| **Open/Closed** | The existing api-server is untouched until cutover (Phase 6). New resources are added in parallel; nothing in production is modified mid-migration. |
| **Liskov Substitution** | Where the new backend can mimic the old backend's behavior at the HTTP boundary (e.g. response shapes), it should — to keep dashboard changes minimal. We document every place we deliberately diverge. |
| **Interface Segregation** | Auth, data persistence, asset storage, observability — each concern is migrated independently with its own success criteria. |
| **Dependency Inversion** | The dashboard already abstracts API calls behind `customFetch` + `setBaseUrl` + `setAuthTokenGetter`. We swap the implementation behind those abstractions, not invent new abstractions. |

**Operational principles** (not SOLID but equally important):

- **Parallel deploy, late cutover** — Strangler Fig pattern. The new backend runs alongside the old one; we cut over only when the new is verified.
- **Reversible at every phase** — every step has a documented rollback. No bridges burned until the very end.
- **Verification gates** — no phase advances without explicit smoke-test sign-off.
- **Documentation alongside code** — `DEPLOY.md`, `TRACKER.md`, and `DEPLOYMENT-RECAP.md` are updated *during* each phase, not at the end.
- **Minimize blast radius** — if anything breaks, we only break dev. Prod is migrated only after dev has been stable on the new backend for at least 24 hours.

---

## 3. Architecture target

```
Before (today)                          After (target)
──────────────────                      ──────────────────────
Extension                               Extension
   ↓ Clerk JWT                             ↓ JWT (self-hosted)
api-server                              velo-qa-server
   ↓ verifies via Clerk                    ↓ verifies own token
Postgres (Drizzle)                      Postgres (Prisma)
                                           ↓
                                        Workspaces, Memberships,
                                        Invites, Refresh tokens

Dashboard                               Dashboard
   ↓ Clerk session +                       ↓ Email/password login,
     Authorization: Bearer                   stores JWT in cookie or LS
api-server                              velo-qa-server
```

| | Before | After |
|---|---|---|
| Backend codebase | `artifacts/api-server/` | `velo-qa/server/` |
| Backend framework | Express 5 | Fastify 4 |
| Auth | Clerk (SaaS) | Self-hosted JWT + argon2id refresh-rotation |
| ORM | Drizzle | Prisma |
| DB tables | `recordings`, `snapcap_users` | `User`, `Workspace`, `Membership`, `Jam`, `JamAsset`, `Invite`, `RefreshToken`, `ApiKey`, `EmailVerification` |
| Email service | None (Clerk handles) | SMTP — Azure Communication Services Email or external |
| Asset storage | Azure Blob (`velocapstdev01/assets`) | Postgres `JamAsset.data Bytes` (per FRD Phase 2.1; later move to Blob) |

---

## 4. Risk register

Before starting, acknowledge what could bite us:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `velo-qa/server` has incomplete features (per its own tracker) | High | Medium — features the team expected may not exist | Audit before starting; document gaps in `infra/TRACKER.md` |
| Verification email flow needs SMTP | Certain | Low — easy to provision via Azure Communication Services | Provision ACS Email in Phase 2 |
| Dashboard rewire breaks visible UX during transition | High | High — team can't use the dashboard mid-migration | Keep the old dashboard live until new is fully tested; cutover via env var, not code change |
| Extension users have to re-sign-in after CWS update | Certain | Low — one-time inconvenience | Notify team in advance; document in changelog |
| CWS review for the JWT-flavored extension takes 3–14 days | Certain | Low — old extension keeps working until update auto-applies | Plan around the wait window |
| Data in dev Postgres gets dropped (Drizzle → Prisma migration) | Certain | Low — only test data | Snapshot first if anything is worth keeping |
| Team confusion about which backend to use | High | Medium — wasted PRs, conflicting work | Comms plan + visible status in TRACKER.md |
| Cutover causes brief unavailability | Medium | Low — minutes, not hours | Cutover during low-usage hours; document precise steps |

---

## 5. Phase plan

### Phase 0 — Preparation (4 hours)

**Goal:** Get aligned on scope, audit the new backend, set up working conditions.

Tasks:
- [ ] Audit `velo-qa/server` code for completeness against the FRD's Phase 1–4 requirements
- [ ] Document gaps in `velo-qa/server/tracker/TRACKER.md` (or surface them here)
- [ ] Verify `velo-qa/server` builds cleanly from a fresh `pnpm install`
- [ ] Verify Prisma migrations apply to a local Postgres
- [ ] Verify the test suite (vitest is in deps; check if any tests exist)
- [ ] Decide: SMTP provider — Azure Communication Services Email vs external (Mailgun/SendGrid/etc.)
- [ ] Decide: do we need email verification on day 1, or can we ship with verification disabled?
- [ ] Notify the team via Slack/email that backend migration is starting

**Verification gate:** Audit document committed. Team sign-off on SMTP choice.

**Rollback:** Trivial — nothing has changed.

---

### Phase 1 — Build pipeline for velo-qa/server (4 hours)

**Goal:** Make `velo-qa/server` packageable as a Docker image in ACR.

Tasks:
- [ ] Add `velo-qa/server/Dockerfile` (multi-stage: pnpm install → tsc build → runtime alpine)
- [ ] Add Prisma generation to the Dockerfile (must run `prisma generate` before build)
- [ ] Add `velo-qa` to root `pnpm-workspace.yaml`? Or keep it as a sub-workspace? **Decision:** keep as sub-workspace; the Dockerfile installs from `velo-qa/` as build context.
- [ ] Add `.dockerignore` entries for the new context
- [ ] `az acr build --registry velocapcr --image velo-server:<sha> --file velo-qa/server/Dockerfile velo-qa/`
- [ ] Verify image lands in ACR
- [ ] Pull image locally + run with mocked env vars to confirm boot

**Verification gate:** Image in ACR, runs locally, responds 200 on `/health`.

**Rollback:** Don't deploy the image; nothing affected.

---

### Phase 2 — Parallel infrastructure (4 hours)

**Goal:** Stand up the new backend's resources WITHOUT touching the existing api-server.

Tasks:
- [ ] Add a new module `infra/modules/velo-server-app/` (Container App tailored to velo-qa/server's needs — different env vars, no Clerk references, JWT_SECRET secret, SMTP config)
- [ ] Update `infra/envs/dev/main.tf`:
  - Generate `random_password` for `JWT_SECRET`
  - Add KV secret `jwt-secret`
  - Add Azure Communication Services Email resource (or note that SMTP is external)
  - Add new Container App `velocap-api-v2-dev` (separate from existing `velocap-api-dev`)
  - Wire env vars
- [ ] `terraform plan` review with the team
- [ ] `terraform apply`
- [ ] Smoke test the new endpoint: `curl https://velocap-api-v2-dev.../health`
- [ ] Apply Prisma migrations to Postgres:
  - Create a new database `velocap_v2` (don't touch existing `velocap` DB which has Drizzle schema)
  - `DATABASE_URL=...velocap_v2 pnpm --filter @veloqa/server prisma migrate deploy`

**Verification gate:**
- New Container App revision is Healthy
- `/health` returns 200
- `/auth/register` accepts a request and creates a user in Postgres
- Existing `velocap-api-dev` still works (untouched)

**Rollback:** `terraform destroy` on the v2 module + `DROP DATABASE velocap_v2;`. Existing system unchanged.

---

### Phase 3 — Backend functional verification (2 hours)

**Goal:** Verify the new backend works end-to-end via direct curl, before any client code changes.

Tasks:
- [ ] Test the full auth flow with curl:
  - `POST /auth/register` → user created
  - `POST /auth/login` → access token + refresh cookie
  - `GET /auth/me` with bearer → user profile
  - `POST /auth/refresh` with cookie → new access token
- [ ] Test workspace flow:
  - `POST /workspaces` → create workspace
  - `GET /workspaces` → list
  - `POST /workspaces/:id/invites` → invite a member
- [ ] Test jam flow:
  - `POST /jams` with multipart payload → jam saved
  - `GET /jams` → list user's jams
  - `GET /jams/:id` → detail
  - `GET /jams/assets/:id` → asset bytes
- [ ] Test public viewer:
  - `GET /j/:id` for a `PUBLIC` jam → returns
  - `GET /j/:id` for a `WORKSPACE` jam without membership → 403

**Verification gate:** All curl tests pass. Document any deviations from expected behavior.

**Rollback:** Same as Phase 2 — `terraform destroy` on v2 resources.

---

### Phase 4 — Dashboard migration (1–2 days)

**Goal:** Rewire the dashboard to use velo-qa/server's auth + API.

This is the largest phase by line-count. It happens on a feature branch, not on `development`.

Tasks:
- [ ] Create branch `feat/dashboard-velo-server`
- [ ] **Auth replacement:**
  - Remove `@clerk/react` from `package.json`
  - Remove `<ClerkProvider>` from `App.tsx`
  - Remove `ClerkApiTokenBridge`, `ClerkQueryClientCacheInvalidator`
  - Remove `<SignIn>` / `<SignUp>` from `pages/sign-in.tsx`, `sign-up.tsx`
  - Add new `pages/sign-in.tsx`, `sign-up.tsx` with email/password forms
  - Add a session context that:
    - Stores access token in memory (or sessionStorage)
    - Refreshes via `/auth/refresh` cookie when access token expires
    - Provides `useUser()` hook
- [ ] **API client replacement:**
  - Update `customFetch.ts`'s `setAuthTokenGetter` to read from the new session context
  - Regenerate Orval client against velo-qa/server's API shape (need OpenAPI spec — generate one if missing)
  - Replace `/api/recordings*` calls with `/jams*`
  - Replace `recording.id` etc. with `jam.id` (Prisma uses cuid, Drizzle used uuid — IDs are still strings)
  - Update field names: `videoObjectPath` → `assets[0].id`, etc.
- [ ] **UX adjustments:**
  - Add a workspace switcher (new feature — velo-qa/server has workspaces)
  - Update `<ProtectedRoute>` to use new session context
  - Settings page: remove "API key" section (velo-qa/server has separate `ApiKey` model — wire later)
- [ ] Smoke test locally against `velocap-api-v2-dev`
- [ ] PR + review
- [ ] Build + deploy to a SECOND SWA (`velocap-swa-v2-dev`) — keep old SWA serving the Clerk-flavored dashboard

**Verification gate:** New SWA loads; sign up + sign in works; recordings list loads; recording detail page plays the video; share link works.

**Rollback:** Don't promote `feat/dashboard-velo-server` to `development`. The old dashboard at the old SWA is still serving traffic.

---

### Phase 5 — Extension migration (4 hours + CWS review)

**Goal:** Revert the Clerk-callback flow in `velo-qa/extension` and use velo-qa/server's `/auth/login`.

Tasks:
- [ ] Create branch `feat/extension-velo-server`
- [ ] Revert the Clerk-callback content script (`auth-callback.ts`) — remove or repurpose
- [ ] Re-enable the original popup login form (email/password) — was overridden by the merge
- [ ] Update `velo-qa/extension/src/shared/api.ts`:
  - Remove `verifyClerkToken` (no longer needed)
  - Use `login` flow as primary — `/auth/login` against velo-qa/server
  - Storage key `veloqa.auth` already in place
- [ ] Update `velo-qa/extension/src/manifest.config.ts`:
  - Remove `externally_connectable` for dashboard (no longer needed if not using callback)
  - Or keep it for future re-use
- [ ] Build with `EXT_BUILD_MODE=release`, target the v2 dev backend:
  ```
  VITE_API_URL=https://velocap-api-v2-dev.../api
  VITE_DASHBOARD_URL=https://velocap-swa-v2-dev.../
  ```
- [ ] Bump version in `manifest.config.ts` (e.g. 0.2.0)
- [ ] Zip + upload to CWS as a new version
- [ ] Wait for CWS review (3–14 days)

**Verification gate:** Extension installs, popup login form accepts credentials, recording uploads to v2 backend, video plays in v2 dashboard.

**Rollback:** Don't push the new CWS version live. Old version (Clerk-flavored) keeps working until you flip the live channel.

---

### Phase 6 — Cutover (1 hour, plus Phase 5 wait)

**Goal:** Promote the v2 stack to be the canonical dev environment. Decommission v1.

Tasks:
- [ ] Verify v2 stack (api + dashboard + extension) has been working in dev for ≥24 hours
- [ ] Plan the cutover window — communicate to team
- [ ] Rename Terraform resources:
  - `velocap-api-dev` → `velocap-api-dev-OLD` (or destroy)
  - `velocap-api-v2-dev` → `velocap-api-dev`
  - `velocap-swa-dev` → `velocap-swa-dev-OLD` (or destroy)
  - `velocap-swa-v2-dev` → `velocap-swa-dev`
  - Database `velocap_v2` → swap with `velocap` (or just keep using `velocap_v2`)
- [ ] Or simpler: leave the v2 names in place permanently, retire v1 outright
- [ ] Update `DEPLOY.md` URLs to point at new resources
- [ ] Update `infra/TRACKER.md`
- [ ] Destroy v1 resources via `terraform destroy` after a 7-day stability buffer

**Verification gate:** Team confirms the new stack works for their daily flows. No critical errors in App Insights for 24h.

**Rollback after cutover:** This is the bridge-burning moment. Rollback means re-deploying the v1 stack from a tagged commit on `development`. Costly but possible — the v1 image is still in ACR.

---

### Phase 7 — Cleanup (4 hours)

**Goal:** Remove dead code, update documentation, settle the new state.

Tasks:
- [ ] Delete `artifacts/api-server/` (or move to `archive/`)
- [ ] Delete `artifacts/snapcap-dashboard/` (replaced by the new dashboard — decide where the new dashboard lives: `artifacts/dashboard/` or `apps/dashboard/`)
- [ ] Delete `lib/db` (Drizzle — no longer needed; replaced by Prisma in `velo-qa/server/prisma/`)
- [ ] Delete `lib/api-zod`, `lib/api-client-react`, `lib/api-spec` (Orval-generated; replaced)
- [ ] Update `pnpm-workspace.yaml` — remove dead workspace patterns
- [ ] Update `DEPLOY.md` — every command, URL, and image tag refreshed
- [ ] Update `LOCAL-DEV.md` — new auth, new API
- [ ] Update `infra/TRACKER.md` — migration phase logged in changelog
- [ ] Update `DEPLOYMENT-RECAP.md` — add a new top section "Backend migration (2026-XX)" telling the story
- [ ] Update `velo-qa/extension/CWS-SUBMISSION.md` — new permission justifications, new URLs
- [ ] Audit `.env.example` files — remove Clerk references
- [ ] Production: repeat Phases 2, 3, 6 for the prod environment

**Verification gate:** `git grep "clerk\|api-server\|snapcap-dashboard\|drizzle\|@workspace/api-zod"` returns nothing meaningful. Repo passes typecheck cleanly.

---

## 6. Timeline

Optimistic estimate, assuming no blockers:

```
Day 1:  Phase 0 (audit + decisions)
Day 2:  Phase 1 (build pipeline) + Phase 2 (parallel infra)
Day 3:  Phase 3 (backend functional verification)
Day 4–5:  Phase 4 (dashboard migration)
Day 6:  Phase 5 setup (extension code change + CWS upload)
Day 7–14:  Wait for CWS review
Day 15:  Phase 5 verify + Phase 6 cutover
Day 16:  Phase 7 cleanup
```

Realistic estimate, with one or two blockers: **2–3 weeks total elapsed**, **5–7 working days of focused effort**.

## 7. Cost during migration

While running both stacks in parallel, monthly cost roughly doubles for the duration:

| Resource | Now | During migration |
|---|---|---|
| Container Apps (2 → 4) | ~$5–10/mo | ~$10–20/mo |
| Postgres (still 1 server, two databases) | ~$25/mo | ~$25/mo |
| Storage, KV, ACR, LAW, App Insights | ~$10/mo | ~$10/mo (shared) |
| **Estimated total** | **~$50/mo** | **~$60–70/mo** |

Increase is small because Container Apps scale to zero when idle.

## 8. Communication plan

- **Day 0 (start):** Slack message to team — "Backend migration starting per Summary Table. Existing dev environment continues to work; new stack will be at v2 URLs. Your daily flow doesn't change until cutover."
- **Phase 4 complete:** "New dashboard at `velocap-swa-v2-dev` — try it out. Old dashboard still works."
- **Phase 5 complete:** "New extension version uploaded to CWS, awaiting review. When approved, you'll get an auto-update — you'll need to re-sign-in with email/password."
- **Phase 6 cutover:** "Migration done. New stack is canonical. Old resources will be retired in 7 days."

## 9. Decision log

These need explicit answers before Phase 0 starts:

- [ ] **SMTP:** Azure Communication Services Email vs external (e.g. Resend / Mailgun)?
- [ ] **Email verification on day 1?** If yes, SMTP is critical-path. If no, ship with verification disabled, add later.
- [ ] **Dashboard fate:** rewire the existing `snapcap-dashboard` (preferred — keeps git history) or build new?
- [ ] **Asset storage:** keep using Azure Blob (override velo-qa/server's inline-Postgres approach) or accept inline-Postgres for now?
- [ ] **Code rename SnapCap → VeloCap:** do during this migration or as a separate pass?

## 10. Open follow-ups parked for after migration

- Migrate to commercial Azure subscription (Sponsorship TOU forbids prod traffic)
- Live Clerk → no longer relevant; we're moving off Clerk
- Custom domain + Front Door + WAF
- VNet + private endpoints
- CI/CD activation (workflows would need updating to target the v2 stack)
- Postgres HA / zone-redundant
- DR drill

## 11. Sign-offs needed

Before Phase 0 starts:

- [ ] You (Tareq) confirm scope + budget
- [ ] Adham (repo owner) acknowledges and is OK with the team disruption window
- [ ] Malak (Owner) acknowledges (especially if SMTP requires new resources or sub-scope role assignments)
- [ ] Mohammad (the dev who introduced the Clerk integration) — courtesy heads-up that their work is being reverted

## 12. What this plan is NOT

- Not a rewrite of `velo-qa/server` itself — we use it as-is, accept its current scope
- Not a feature-add — workspaces ship because they're in `velo-qa/server`, but we're not building new functionality during the migration
- Not a rebrand — code rename `SnapCap → VeloCap` is parked; we'll do it before migration starts to a known stable state, OR after migration, but not during
- Not optimization — performance / SLO work happens after cutover stabilizes
