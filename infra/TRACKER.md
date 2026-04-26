# VeloCap — Deployment tracker

Living status of the Azure deployment. Update after any meaningful change
(deploy, config flip, blocker found, decision revisited). Keep honest.

**Legend:** ⬜ not started · 🟨 in progress · ✅ done · ⏸ deferred · ⚠️ blocker

---

## TL;DR — current state (2026-04-26)

**Deployment is functionally done.** Both dev and prod environments are live on Azure under the `VeloCap` resource group. End-to-end flow works (extension → Clerk → ACA → Postgres → Blob). Monitoring + budget configured. App Insights SDK reporting telemetry. Manual deploys via `DEPLOY.md`; CI/CD assets committed but **deferred** until team coordination unblocks.

**Where we are on the spectrum**:

```
[Nothing deployed] → [Hand-typed deploys] → [Documented runbook] ← YOU ARE HERE
                                                  ↓
                                       [Auto-deploy on push, prod approval gate]
                                                  ↓
                                       [Full automation, blue/green, canaries]
```

---

## Locked decisions

| # | Topic | Choice |
|---|---|---|
| Q1 | Components to ship | `artifacts/api-server/` + `artifacts/snapcap-dashboard/` + `velo-qa/extension/` (code unchanged) |
| Q2 | Subscription | **The JUMP App Subscription** · `fb42fb29-4fcc-40a9-9ff0-21ef191674af` · **Sponsorship** (`Sponsored_2016-01-01`) |
| Q2 | Tenant | `malakalsaffarthejumpapp.onmicrosoft.com` · `0451fcf1-2dd9-4eff-90e3-8396b9df62d9` |
| Q3 | Environments | Prod + Dev, single RG `VeloCap`, suffixed |
| Q4 | Region | `uaenorth` (3 AZs) |
| Q5 | Domain / DNS | None — Azure default URLs for v1 |
| Q6 | Compute | SWA (dashboard) + ACA (backend) |
| Q7 | Auth | Keep Clerk (test instance `firm-tapir-95`) |
| Q8 | IaC | Terraform, remote state in Azure Storage |
| Q9 | CI/CD | GitHub Actions + OIDC — assets written, **deferred until team needs auto-deploy** |
| Q10 | Compliance | None |
| Q11 | Budget | Minimal SKUs, ~$50/mo dev+prod combined |
| Q12 | Ops | Azure Monitor alerts → email (`tareq@` + `info@`) |
| — | RBAC approach | **Option 2** — no sub-scope role assignments. KV access policies, ACR admin user, storage connection string in KV, shared-key TF backend. |

## Deployer

- **Identity:** `tareq@menatal.com`
- **Azure role:** Contributor on sub (sufficient under Option 2)
- **GitHub:** Collaborator on `AdhamMehdawi/Browser-Capture-Jam` (added by Adham 2026-04-26)
- **Manual-deploy playbook:** `DEPLOY.md` at repo root

---

## Phases

### Phase 0 — Pre-flight ✅
- ✅ Subscription confirmed (ID, tenant, offer type = Sponsorship)
- ✅ Region decided (`uaenorth`)
- ✅ Deployer role verified (Contributor, Option 2 chosen)
- ⚠️ **Sponsorship credit balance** still unverified — Malak to check at https://www.microsoftazuresponsorships.com/Balance
- ⏸ Tareq Owner-role elevation (explicitly deferred — Option 2 means we don't need it)

### Phase 1 — State backend bootstrap ✅
- ✅ `velocap-tfstate-rg` RG created
- ✅ `velocaptfstateaue01` Storage Account + `tfstate` container
- ✅ `infra/bootstrap/` Terraform applied (local state)
- ✅ Remote state backend uses shared-key auth (Option 2)

### Phase 2 — Shared infra
Merged into Phase 3 — `velocapcr` (ACR) and `velocap-law-dev` (Log Analytics)
were created as part of the dev env apply rather than a separate shared stack.
Prod uses ACR via data source.

### Phase 3 — Dev env infra ✅
All 19 resources applied successfully (2026-04-21).

### Phase 4 — API port to Azure ✅
- ✅ `objectStorage.ts` + `objectAcl.ts` rewritten for `@azure/storage-blob`
- ✅ Dependencies swapped: removed `@google-cloud/storage` + `google-auth-library`
- ✅ Dockerfile + `.dockerignore` (uses `pnpm deploy --legacy`; matches build/runtime WORKDIR for `esbuild-plugin-pino` workers)
- ✅ ACA running api-server, `/api/healthz` returns 200

### Phase 5 — Dashboard + Clerk + smoke test ✅
- ✅ Drizzle schema pushed to `velocap-pg-dev` (`recordings`, `snapcap_users`)
- ✅ Clerk keys in KV (real `sk_test_*` / `pk_test_*` from `firm-tapir-95` Clerk instance)
- ✅ TF data sources read live KV values, propagate to ACA secret store on each apply
- ✅ Dashboard built + deployed; in-browser sign-in works
- ✅ Cross-origin auth resolved via `ClerkApiTokenBridge` in `App.tsx` (Clerk JWT in `Authorization: Bearer` header instead of cookie)
- ✅ `customFetch` base URL wired via `setBaseUrl(VITE_API_URL)` in `main.tsx`
- ✅ SPA navigation fallback (`staticwebapp.config.json`) — `/dashboard`, `/extension-auth`, etc. don't 404
- ✅ Browser smoke test passed: sign-in → recordings list loads via Bearer JWT

### Phase 6 — Prod env ✅
- ✅ `infra/envs/prod/` composes the same modules; 18 resources applied
- ✅ ACR shared with dev via data source; LAW / KV / Storage / Postgres / ACA env / ACA / SWA all separate
- ✅ Drizzle schema pushed to `velocap-pg-prod`
- ✅ Clerk secrets in `velocap-kv-prod` (same test keys as dev for now)
- ✅ Dashboard deployed to `velocap-swa-prod` with prod `VITE_API_URL`
- ✅ Smoke test: `/api/healthz` → 200; `/api/recordings` → 401 (Clerk gating works)
- ⚠️ **NODE_ENV=development** on prod ACA — Clerk Express rejects `pk_test_*`/`sk_test_*` keys when `NODE_ENV=production`. Flip to "production" once a live Clerk instance (`pk_live_*`) is provisioned.

### Phase 7 — CI/CD + alerts + observability + extension
- 🟨 **7.1 GitHub Actions CI/CD** — workflows + runbook committed (`ca011aa`); branch pushed to origin (2026-04-26). NOT active. Blocked on Malak/Aref creating the Entra app reg + role assignments. **User decision: deferred.** Manual deploys via `DEPLOY.md` instead.
- ✅ **7.2 Alerts + budget** — `velocap-ag-email-prod` action group emails Tareq + info; alerts on ACA replicas=0 and Postgres CPU>80%/15m; $100/mo RG-scope budget with 50/80/100% thresholds.
- ✅ **7.3 Extension build for CWS** — release-mode build strips localhost; manifest renamed `Velo QA → VeloCap`; privacy policy hosted at `<dashboard>/privacy.html`; zipped at `velocap-extension-dev.zip`; submission reference at `velo-qa/extension/CWS-SUBMISSION.md`. Tareq to complete listing + submit.
- ✅ **7.4 App Insights SDK** — `applicationinsights@2.9.6` loaded via `createRequire()` (avoids ESM/CJS interop bug). Auto-collects requests, performance, exceptions, dependencies, console. Both envs running image `0ca187b-ai2` with telemetry flowing to `velocap-appi-{dev,prod}`.
- ⬜ 7.3b — Re-build extension for prod + re-publish once dev listing is approved.

### Phase 8 — Operations runbook ✅
- ✅ `DEPLOY.md` at repo root: 10 numbered operations, verification, troubleshooting, reference. Used for manual deploys until CI/CD is activated.

---

## Live resource snapshot

### Resource group `VeloCap` (uaenorth)

**Dev:**
| Resource | Name | Notes |
|---|---|---|
| Log Analytics | `velocap-law-dev` | 1 GB/day cap, 30d retention |
| App Insights | `velocap-appi-dev` | workspace-based; receiving telemetry from api-server |
| Key Vault | `velocap-kv-dev` | Access-policy mode; 7 secrets including real Clerk keys |
| Storage | `velocapstdevaue01` | `assets` container holds recording media |
| Postgres | `velocap-pg-dev` | B1ms 32 GB; schema applied; `tareq-laptop-temp` firewall rule for dev-time access |
| ACA env | `velocap-cae-dev` | logs → `velocap-law-dev` |
| Container App | `velocap-api-dev` | image `velocapcr.azurecr.io/api-server:0ca187b-ai2`; FQDN `velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io` |
| Static Web App | `velocap-swa-dev` | Free; FQDN `salmon-sea-0c8c28b03.7.azurestaticapps.net`; built with real `pk_test_*` Clerk key |

**Prod:**
| Resource | Name | Notes |
|---|---|---|
| Log Analytics | `velocap-law-prod` | 2 GB/day cap |
| App Insights | `velocap-appi-prod` | receiving telemetry |
| Key Vault | `velocap-kv-prod` | 7 secrets; same test Clerk keys as dev |
| Storage | `velocapstprodaue01` | `assets` container |
| Postgres | `velocap-pg-prod` | B1ms 32 GB; 14d PITR; schema applied; `tareq-laptop-temp` firewall rule |
| ACA env | `velocap-cae-prod` | |
| Container App | `velocap-api-prod` | image `velocapcr.azurecr.io/api-server:0ca187b-ai2`; FQDN `velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io`; min=1 replica (warm); `NODE_ENV=development` (Clerk test-key workaround) |
| Static Web App | `velocap-swa-prod` | Free; FQDN `ambitious-wave-08351ef03.7.azurestaticapps.net` |
| Action group | `velocap-ag-email-prod` | email tareq@ + info@ |
| Alert | `velocap-alert-api-down-prod` | sev 1: ACA replicas < 1 |
| Alert | `velocap-alert-pg-cpu-prod` | sev 2: Postgres CPU > 80% over 15m |
| Budget | `velocap-monthly-budget` | $100/mo, alerts at 50/80/100% actual |

**Shared (dev "owns" via TF, prod uses via data source):**
| Resource | Name | Notes |
|---|---|---|
| ACR | `velocapcr` | Basic, admin-enabled. Holds `api-server:0ca187b-ai2`, `:latest`, and prior tags |

### Resource group `velocap-tfstate-rg` (uaenorth)

| Resource | Name |
|---|---|
| Storage | `velocaptfstateaue01` / container `tfstate` / blobs `dev.tfstate`, `prod.tfstate` |

---

## GitHub state

- Branch `development` (formerly `deployment`) pushed to origin at https://github.com/AdhamMehdawi/Browser-Capture-Jam/tree/development; new `production` branch created at the same head
- Tareq is **collaborator** with Write role
- Repo secrets configured: `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- GitHub environment `prod` created with Required Reviewers
- ⏸ Missing: `AZURE_CLIENT_ID` (waits on Malak's Entra app reg)
- Workflows in `.github/workflows/` are committed but **dormant** — they trigger on push but fail at the Azure login step until the Entra app reg exists

---

## Open items / known gaps

### ⚠️ Active items needing action
1. **Sponsorship credit balance unverified** — Malak to check at https://www.microsoftazuresponsorships.com/Balance.
2. **`.env` files contain real `sk_test_*` Clerk key in git history** — needs rotation + `.gitignore`. Coordinate with the teammate who committed them.
3. **`tareq-laptop-temp` Postgres firewall rules** on both `velocap-pg-dev` and `velocap-pg-prod`. Remove when no longer actively developing.
4. **Dev Postgres firewall is open to 0.0.0.0–255.255.255.255** (rule `allow-all-temp-handover`, added 2026-04-26 for cross-device handover). Auth still required, but server is exposed to brute-force / port scans. Close when the handover situation ends:
   ```
   az postgres flexible-server firewall-rule delete \
     -g VeloCap -n velocap-pg-dev --rule-name allow-all-temp-handover -y
   ```
5. **`production` branch is currently behind `development`** by docs-only commits since the last prod deploy. The fast-forward step in `DEPLOY.md` Op 2 catches it up automatically on the next prod promote. Not blocking.

### ⏸ Deferred (tracked, not urgent)
4. **CI/CD activation** — needs Malak to run `infra/CICD-SETUP.md` Step 2 (~2 min). User chose to defer; manual deploys via `DEPLOY.md` are sufficient for current team size + cadence.
5. **Live Clerk instance for prod** — replace test keys with `pk_live_*` / `sk_live_*`, flip prod ACA `NODE_ENV` back to `production`. Triggered when first paying customer commits.
6. **Migrate to commercial sub (PAYG/MCA)** — required before sponsored sub sees real customer traffic (Sponsorship TOU).
7. **Code rename** `SnapCap → VeloCap` in source (DB table `snapcap_users`, package names `@workspace/*`, dashboard folder name). Manifest already done; rest deferred.
8. **CWS extension review** — Tareq to finish listing form + submit (review takes 3–14 days per Google).

### 🟢 Production-hardening (for "real prod" later)
9. **Custom domain + Front Door + WAF**
10. **VNet + private endpoints** on KV, Postgres, Storage, ACR
11. **Postgres zone-redundant HA** (currently single-AZ)
12. **MSI + RBAC instead of admin keys** (currently using Option 2)
13. **ACR tag immutability** (Premium SKU)
14. **DR drill** — geo-redundant backup, cross-region replica, restore test
15. **Code-split dashboard bundle** (currently 980 KB single chunk)

---

## Changelog (newest first)

- **2026-04-26** — **Backend stack decision reaffirmed.** Considered swapping deployed `artifacts/api-server` for `velo-qa/server` (per the team's earlier "Summary Table" plan), drafted a SOLID-grounded migration plan, then walked it back. Decision: keep `artifacts/api-server` (Express + Clerk + Drizzle) as the canonical backend; the merged Clerk integration (`c1039f2`) effectively moved the project there, and reverting would be 2-3 weeks of work for marginal benefit. `velo-qa/server` stays in the repo as reference but is not deployed. (Migration plan history at commits `a5baf8d` add → `127aec0` delete.)
- **2026-04-26** — Cross-device handover material generated. `HANDOVER.md` + `VeloCap-Handover.docx` (both gitignored, contain live credentials) authored to share full deployment context with another machine. Dev Postgres firewall opened to 0.0.0.0 (rule `allow-all-temp-handover`) so the other machine can connect; close it when handover ends.
- **2026-04-26** — **Branch model formalized.** Renamed `deployment` branch to `development`; created new `production` branch from the same head. Workflows updated: `deploy-dev.yml` triggers on push to `development`, `deploy-prod.yml` triggers on push to `production` (gated by required-reviewer rule on the `prod` GitHub environment). CI/CD still dormant pending Malak's Entra app reg.
- **2026-04-26** — Local-dev experience polished. `LOCAL-DEV.md` written, root `pnpm dev` script runs api + dashboard concurrently with colored logs, api-server `dev` script switched to `tsx watch` for instant hot-reload, dashboard's `vite.config.ts` no longer requires `PORT` env var (defaults to 3001).
- **2026-04-26** — `DEPLOYMENT-RECAP.md` added at repo root — narrative walkthrough of every deployment phase for future devs / Claude sessions to read top-to-bottom.
- **2026-04-26** — Wrote `DEPLOY.md` runbook (511 lines) at repo root; covers all manual deploy + maintenance ops. CI/CD activation officially deferred — manual deploys are the path forward for now. `deployment` branch pushed to origin (after Adham added Tareq as collaborator). GitHub repo secrets `AZURE_TENANT_ID` + `AZURE_SUBSCRIPTION_ID` configured; `prod` GitHub environment created. `AZURE_CLIENT_ID` still pending Malak's Entra app reg.
- **2026-04-24** — Application Insights SDK wired into api-server. `createRequire()` pattern avoids an ESM interop bug where `import * as appInsights` returned a namespace missing `defaultClient`. Both envs now emit telemetry (`velocap-appi-dev`, `velocap-appi-prod`). Image `0ca187b-ai2` deployed to dev + prod.
- **2026-04-23** — Phase 7.2 done. Prod alerts + $100/mo RG budget applied. Action group emails tareq@ + info@. Alerts for ACA replica=0 and Postgres CPU>80% sustained 15m. Budget thresholds at 50/80/100% actual.
- **2026-04-23** — Phase 7.1 assets drafted — 3 GH Actions workflows + `infra/CICD-SETUP.md` runbook committed on `deployment` branch.
- **2026-04-23** — Durability fix (`b584267`) deployed to dev + prod. Recordings now persist to Azure Blob; survive container restarts.
- **2026-04-23** — Extension for CWS submission: release-mode build strips localhost, name renamed `Velo QA → VeloCap` in manifest, privacy policy hosted at dashboard `/privacy.html`, zipped package + submission reference doc ready.
- **2026-04-23** — Phase 6 done. Prod env stood up (18 resources). ACR shared with dev via data source. Hit one gotcha: Clerk Express refuses `sk_test_*` keys when `NODE_ENV=production` — left prod with `NODE_ENV=development` until a live Clerk instance exists.
- **2026-04-23** — Phase 5 fully done. Browser smoke test passed after two fixes: (1) `main.tsx` now calls `setBaseUrl(VITE_API_URL)` (`9c9b3e4`); (2) Added `ClerkApiTokenBridge` in `App.tsx` (`df517a7`) — Clerk JWT flows via `Authorization: Bearer` header (cross-origin cookies don't work).
- **2026-04-23** — Merged `origin/main` into `deployment` (merge commit `671703c`) to pick up Clerk integration. Added KV data sources so live secret values flow into ACA. MOCK_AUTH removed.
- **2026-04-22** — Dashboard built + deployed to `velocap-swa-dev` via SWA CLI.
- **2026-04-22** — Phase 5 started. Drizzle schema pushed to `velocap-pg-dev`; `GET /api/recordings` returns real data end-to-end. Postgres admin password regenerated without special chars after `random_password` default tripped URL parsing in the pg driver. Laptop firewall rule `tareq-laptop-temp` added.
- **2026-04-22** — Phase 4 done. api-server image `09d89c8-fix2` pushed to `velocapcr`, running in `velocap-api-dev`, `/api/healthz` returning 200. Option A (SnapCap stack) locked after the "Summary Table" image revealed the velo-qa/server + snapcap-dashboard + velo-qa/extension mix wasn't coherent.
- **2026-04-22** — Tracker file created. Phases 0–3 marked done retroactively.
- **2026-04-21** — `infra/envs/dev` applied (19 resources). Container App on placeholder image; Postgres + KV + Storage + ACR all provisioned. Commit `2f8fa9d`.
- **2026-04-21** — Bootstrap stack applied. `velocaptfstateaue01` Storage Account created for remote Terraform state.
- **2026-04-21** — `VeloCap` and `velocap-tfstate-rg` resource groups created via `az group create`.
- **2026-04-21** — Terraform 1.14.9 installed via `brew install hashicorp/tap/terraform`.
- **2026-04-21** — Option 2 RBAC approach locked.
- **2026-04-21** — All 12 design decisions locked. Deployment branch cut from `main` (`f85622d`).
