# VeloCap — complete deployment recap

A plain-English walk-through of everything that's been done to deploy VeloCap to Azure. Read top-to-bottom for the full picture, or jump to a phase you're curious about.

> Last updated: 2026-04-26

## Contents

- [Phase 0 — Understanding what we had](#phase-0--understanding-what-we-had)
- [Phase 1 — Twelve decisions](#phase-1--twelve-decisions)
- [Phase 2 — Setting up the foundations](#phase-2--setting-up-the-foundations)
- [Phase 3 — Writing the infrastructure as code](#phase-3--writing-the-infrastructure-as-code)
- [Phase 4 — Making the app run on Azure](#phase-4--making-the-app-run-on-azure)
- [Phase 5 — Wiring authentication](#phase-5--wiring-authentication)
- [Phase 6 — Standing up production](#phase-6--standing-up-production)
- [Phase 7 — Observability, alerts, the rest](#phase-7--observability-alerts-the-rest)
- [Phase 8 — Operations playbook + handoff](#phase-8--operations-playbook--handoff)
- [Branch model](#branch-model)
- [CI/CD assets (still dormant)](#cicd-assets-still-dormant)
- [What we tried and abandoned](#what-we-tried-and-abandoned)
- [Final state](#final-state)

---

## Phase 0 — Understanding what we had

**Before we started:** the repo had **two parallel implementations of the same product** that didn't talk to each other:

- "SnapCap" — a backend, dashboard, and extension built for Replit
- "Velo QA" — a different backend and a different extension, partially overlapping

We had to pick one to deploy. We chose the SnapCap stack (`api-server` + `snapcap-dashboard`) plus the velo-qa extension, because the merged code from the teammate's `main` had already wired them to talk via Clerk. We renamed the project to **VeloCap**.

We deferred renaming all the code (DB tables, package names) and just focused on getting it deployed.

---

## Phase 1 — Twelve decisions

We answered 12 questions up front so we wouldn't have to backtrack:

| Decision | Answer |
|---|---|
| Which subscription? | "The JUMP App Subscription" (sponsorship credits) |
| Which region? | UAE North |
| How many environments? | Two: dev + prod, both in one resource group called `VeloCap` |
| Custom domain? | Not yet — use Azure-provided URLs |
| What kind of servers? | Container Apps for backend, Static Web Apps for dashboard |
| Auth system? | Keep Clerk (already in the code) |
| Infrastructure-as-code tool? | Terraform |
| CI/CD? | GitHub Actions, OIDC-based |
| Compliance? | None |
| Budget? | Minimum sizes everywhere, ~$50/month |
| Alerts? | Email only |
| Permissions? | Use **Option 2** — minimal roles for the deployer (you), use access policies and admin keys instead of role assignments |

That last one was important: it meant we could do almost everything without bothering Malak.

---

## Phase 2 — Setting up the foundations

We created:

- The **`VeloCap`** resource group (where the app lives)
- A separate **`velocap-tfstate-rg`** resource group (where Terraform stores its memory of what it has built)
- Inside that, a **Storage Account** to hold Terraform state files

This is the "boot loader" — Terraform needs a place to track what it has built before it can build anything else.

---

## Phase 3 — Writing the infrastructure as code

Wrote **9 reusable Terraform modules** (one per type of Azure resource):

- Container Registry (ACR)
- Key Vault
- Postgres (Flexible Server)
- Storage Account
- Log Analytics
- Application Insights
- Container Apps environment
- Container App
- Static Web App

Then composed them into the **dev environment** (`infra/envs/dev/`) and applied — Azure created **19 resources** in about 8 minutes.

---

## Phase 4 — Making the app run on Azure

The api-server code was originally written for Replit, which used a Google Cloud Storage proxy. We had to rewrite it for Azure:

- **Replaced** `objectStorage.ts` to use Azure Blob Storage instead of Replit's GCS proxy
- **Wrote a Dockerfile** so the app could be packaged as a container
- **Built the image** in Azure Container Registry (no Docker needed locally — Azure builds it for us)
- **Deployed** the image to the Container App
- **Pushed the database schema** (Drizzle) to the Postgres instance

Along the way we hit and fixed several bugs:

- The pino logger's worker files baked absolute build paths into the bundle → fixed by matching the runtime working directory to the build directory
- The Postgres admin password contained special characters that broke the connection-string parser → regenerated it as alphanumeric only
- The `routes/jams.ts` route tried to write to local disk on container startup → wrapped it in try/catch so the server still booted

The result: **the api-server returned 200 on `/api/healthz`** for the first time.

---

## Phase 5 — Wiring authentication

Initially the backend ran with `MOCK_AUTH=true` (bypassed Clerk). Then we:

- Pulled real Clerk keys from your teammate's `main` branch (merged after they completed it)
- Stored them in Key Vault using `az keyvault secret set`
- Switched Terraform to read the live KV values (so the next "apply" propagates them)
- Removed the `MOCK_AUTH` bypass
- Built and deployed the dashboard pointing at the dev backend

The first browser test failed: `/api/recordings` returned 404, then 401 even after sign-in. We fixed:

1. **Same-origin requests** — the dashboard was calling `/api/*` on its own URL instead of the backend. Fixed by adding `setBaseUrl()` in `main.tsx`.
2. **SPA routing 404s** — Static Web Apps was returning 404 for `/dashboard`, `/extension-auth` etc. Fixed by adding a `staticwebapp.config.json` with a navigation fallback.
3. **Cross-origin Clerk auth** — Clerk's session cookie doesn't cross from the dashboard domain to the backend domain. Fixed by adding a "ClerkApiTokenBridge" component that grabs the Clerk JWT and attaches it as `Authorization: Bearer ...` on every API call.

After those three fixes, **end-to-end sign-in worked** and `/api/recordings` returned data.

---

## Phase 6 — Standing up production

Created `infra/envs/prod/` as a near-copy of dev with `-prod` suffixes. Applied — **18 resources** (one less than dev because prod reuses the shared ACR via a data source instead of creating its own).

Hit one quirk: Clerk Express refuses test keys (`pk_test_*`/`sk_test_*`) when `NODE_ENV=production`. We left prod's `NODE_ENV` set to `development` for now until you provision live Clerk keys.

Pushed schema, deployed dashboard, smoke-tested. Both environments now run end-to-end.

---

## Phase 7 — Observability, alerts, the rest

### Durability fix

The `/jams` route was originally writing video files to the container's local disk. That's ephemeral on Azure Container Apps — every restart loses the data. We rewrote it to upload videos to Azure Blob Storage instead.

### Application Insights

The connection string was wired but no code was actually emitting telemetry. We:

- Added the `applicationinsights` Node.js SDK
- Initialized it in a separate `instrumentation.ts` file that loads first (so it can monkey-patch HTTP/Postgres/etc.)
- Hit an ESM/CJS interop bug → fixed using `createRequire()`

Now Azure's Application Insights receives every request, exception, and database call from both environments.

### Alerts + budget

Created in `infra/envs/prod/alerts.tf`:

- An action group that emails `tareq@menatal.com` and `info@menatal.com`
- An alert when the api-server has zero running replicas (= service down)
- An alert when Postgres CPU is over 80% for 15 minutes
- A $100/month budget with notifications at 50%, 80%, and 100% spend

### Extension

- Updated the manifest's `externally_connectable` and content-script matches to allow the Azure SWA URLs
- Renamed the extension name `Velo QA → VeloCap` in the manifest
- Added an `EXT_BUILD_MODE=release` flag that strips `localhost` references for Chrome Web Store builds
- Wrote a privacy policy hosted at `<dashboard>/privacy.html`
- Built and zipped a release version (`velocap-extension-dev.zip`)
- Wrote `velo-qa/extension/CWS-SUBMISSION.md` with every field you'd need to fill on the CWS form

---

## Phase 8 — Operations playbook + handoff

Wrote documents so future-you (or the team, or a new Claude session on a different device) can run things without anyone's help:

| File | What it covers |
|---|---|
| **`DEPLOY.md`** | 511 lines, 10 numbered operations: deploy api/dashboard, push schema, rotate secrets, build extension, pause Postgres for credit-saving, etc. + verification + troubleshooting |
| **`infra/TRACKER.md`** | Living status of the deployment — what's done, what's open, every changelog entry |
| **`HANDOVER.md`** (gitignored — has live credentials) | Full connection strings, URLs, secrets, ready to give to another machine |

---

## Branch model

We restructured GitHub branches:

- `development` — what's running in dev
- `production` — what's running in prod
- `main` — long-term canonical reference (currently behind)

Pushing to `development` will trigger a dev deploy (when CI/CD activates). Same for `production` → prod. Until then, you fast-forward `production` from `development` and run the deploy commands from `DEPLOY.md`.

---

## CI/CD assets (still dormant)

We wrote three GitHub Actions workflows:

- `terraform-plan.yml` — comments a TF diff on PRs
- `deploy-dev.yml` — auto-deploy on push to `development`
- `deploy-prod.yml` — auto-deploy on push to `production` (gated by required-reviewer approval)

We also wrote `infra/CICD-SETUP.md` with the exact commands Malak needs to run to wire it up. Until she runs them, the workflows trigger but fail at the Azure login step. Manual deploys via `DEPLOY.md` work in the meantime.

---

## What we tried and abandoned

- **The full SnapCap → VeloCap rename** — started it (rename folder, package names, UI strings, DB table) but reverted because we wanted to focus on deploy first. Still on the list for later.
- **Tag immutability on ACR** — needed a Premium-tier registry (~$160/month extra), not worth it for a sponsorship-funded project.
- **`use_azuread_auth = true` on the Terraform state backend** — required Tareq to have `Storage Blob Data Contributor`, which he doesn't, so we fell back to shared-key auth (still secure, just an older method).

---

## Final state

| | |
|---|---|
| Environments live | 2 (dev + prod) |
| Total Azure resources | 38+ |
| Monthly cost | ~$50, charged against sponsorship credit |
| Branch model | development / production / main |
| Documents written | DEPLOY.md, TRACKER.md, HANDOVER.md, CICD-SETUP.md, CWS-SUBMISSION.md, DEPLOYMENT-RECAP.md (this file) |
| Number of commits on `development` branch | 19+ |
| End-to-end working | Extension records → uploads → Blob storage → DB → dashboard plays back |
| What's still on the team's plate | CI/CD activation (Malak), Chrome Web Store review (Google), live Clerk keys (when paying customers), production hardening (when scale demands) |

---

## Where to look for what

| If you want… | Read this file |
|---|---|
| The history of what we did | `DEPLOYMENT-RECAP.md` (this file) |
| Step-by-step deploy commands | `DEPLOY.md` |
| Current status of every component | `infra/TRACKER.md` |
| To activate CI/CD | `infra/CICD-SETUP.md` |
| To submit the Chrome Web Store listing | `velo-qa/extension/CWS-SUBMISSION.md` |
| Live credentials for a new device | `HANDOVER.md` (gitignored — generated on demand) |
