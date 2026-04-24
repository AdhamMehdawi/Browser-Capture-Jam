# VeloCap — Deployment tracker

Living status of the Azure deployment. Update after any meaningful change
(deploy, config flip, blocker found, decision revisited). Keep honest.

**Legend:** ⬜ not started · 🟨 in progress · ✅ done · ⏸ deferred · ⚠️ blocker

---

## ✅ Phase 5 completed (2026-04-23)

End-to-end flow working on dev. Parallel Clerk branch merged (`671703c`), real keys in KV via `az keyvault secret set`, Terraform using KV data sources so out-of-band secret updates propagate, `MOCK_AUTH` removed, dashboard rebuilt with real publishable key + API-URL base + Clerk-JWT Authorization bridge, deployed to SWA. Browser smoke test passed.

Verification chain:
- `GET /api/healthz` → 200 (public)
- `GET /api/recordings` (unauth'd) → 401 (Clerk gating)
- Dashboard `/dashboard` page after Clerk sign-in → loads stats + recordings via `Authorization: Bearer <JWT>` → 304/200 from ACA backend

**What the merging developer (or reviewer) needs to know:**
- Branch `deployment` at commit `7189cdf` contains all the Azure deployment work.
- Dev env on Azure is live and spending ~$1/day against sponsorship credit.
- Backend `velocap-api-dev` runs with `MOCK_AUTH=true` (returns `demo_user_001` for any request).
- Dashboard at `velocap-swa-dev` was built with `VITE_CLERK_PUBLISHABLE_KEY=pk_test_placeholder` — will show Clerk init errors in the browser.
- The two KV secrets `clerk-secret-key` and `clerk-publishable-key` are stamped `REPLACE_ME` and have `lifecycle.ignore_changes` on value, so `az keyvault secret set` is the right way to update them without Terraform reverting.

**Resume steps when Clerk is ready (in order):**
1. `az keyvault secret set --vault-name velocap-kv-dev --name clerk-secret-key --value sk_test_...`
2. `az keyvault secret set --vault-name velocap-kv-dev --name clerk-publishable-key --value pk_test_...`
3. Edit `infra/envs/dev/main.tf` — remove the `{ name = "MOCK_AUTH", value = "true" }` entry from `env_vars`.
4. `cd infra/envs/dev && terraform apply -var 'api_image=velocapcr.azurecr.io/api-server:09d89c8-fix2'`
5. Rebuild dashboard with the **real** `VITE_CLERK_PUBLISHABLE_KEY`:
   ```bash
   cd artifacts/snapcap-dashboard
   VITE_API_URL=https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io \
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_<real_key> \
   PORT=3000 BASE_PATH=/ pnpm run build
   SWA_TOKEN=$(az staticwebapp secrets list --name velocap-swa-dev --resource-group VeloCap --query properties.apiKey -o tsv)
   npx --yes @azure/static-web-apps-cli deploy ./dist/public --deployment-token "$SWA_TOKEN" --env production --no-use-keychain
   ```
6. Smoke test: open dashboard URL in browser, sign in, verify `/api/me` + `/api/recordings`.

**Cost reminder while paused**: Postgres B1ms (~$20/mo) + ACR Basic (~$5/mo) continue to bill even with zero traffic. ACA scales to zero, SWA Free is free. If the pause is going to be > 1 week, consider `az postgres flexible-server stop -n velocap-pg-dev -g VeloCap` to save ~$0.70/day (stops for max 7 days, then auto-starts).

**Other loose ends**:
- `tareq-laptop-temp` firewall rule is still on `velocap-pg-dev` (my laptop IP `82.213.7.5`). If IP changes or laptop is retired, remove it: `az postgres flexible-server firewall-rule delete -g VeloCap -n velocap-pg-dev --rule-name tareq-laptop-temp -y`.
- `deployment` branch is local-only so far — push to origin if the other developer needs to diff/merge.



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
| Q7 | Auth | Keep Clerk (no change) |
| Q8 | IaC | Terraform, remote state in Azure Storage |
| Q9 | CI/CD | GitHub Actions + OIDC (planned, not built yet) |
| Q10 | Compliance | None |
| Q11 | Budget | Minimal SKUs everywhere, ~$45–90/mo dev+prod |
| Q12 | Ops | Azure Monitor alerts → email only |
| — | RBAC approach | **Option 2** — no sub-scope role assignments. KV access policies, ACR admin user, storage connection string in KV, shared-key TF backend. |

## Deployer

- **Identity:** `tareq@menatal.com`
- **Role:** Contributor on sub (not Owner). Sufficient for everything under Option 2.

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
- ✅ Remote state backend switched to shared-key auth (Option 2)

### Phase 2 — Shared infra
Merged into Phase 3 — `velocapcr` (ACR) and `velocap-law-dev` (Log Analytics)
were created as part of the dev env apply rather than a separate shared stack.
Prod will reuse both.

### Phase 3 — Dev env infra ✅
All 19 resources applied successfully (2026-04-21). See "Live resource snapshot" below.
- ✅ Postgres + firewall + `velocap` database
- ✅ Key Vault + 7 secrets (5 real, 2 placeholder for Clerk)
- ✅ Storage Account + `assets` container
- ✅ ACR Basic (admin-enabled)
- ✅ Log Analytics + App Insights
- ✅ Container Apps environment + `velocap-api-dev` (placeholder image, port 4000 ingress)
- ✅ Static Web App `velocap-swa-dev` (empty, westeurope)

### Phase 4 — API port ✅
- ✅ Patched `objectStorage.ts` + `objectAcl.ts` to use `@azure/storage-blob` (replaces Replit GCS sidecar)
- ✅ Swapped `@google-cloud/storage` / `google-auth-library` → `@azure/storage-blob` in `artifacts/api-server/package.json`
- ✅ Patched `routes/jams.ts` so the top-level `mkdirSync` failure is non-fatal (it was crashing on ACA's read-only FS)
- ✅ Dockerfile + `.dockerignore` (uses `pnpm deploy --legacy` + matches build/runtime WORKDIR to avoid `esbuild-plugin-pino` path bug)
- ✅ `az acr build` pushes `velocapcr.azurecr.io/api-server:09d89c8-fix2` (and `:latest`)
- ✅ Terraform applied with `MOCK_AUTH=true` env var + new image; ACA revision `velocap-api-dev--0000003` is **Healthy**
- ✅ `GET /api/healthz` returns `{"status":"ok"}` in ~440 ms (warm)

Known follow-ups (do NOT block Phase 5):
- ⚠️ `routes/jams.ts` uses local SQLite + local disk for extension uploads — will fail at runtime on ACA. Full rework: route media through Azure Blob, use Postgres instead of SQLite.
- ⚠️ `MOCK_AUTH=true` bypasses Clerk. Remove once real Clerk keys are set in KV (Phase 5).
- ⚠️ Drizzle schema not yet pushed to `velocap-pg-dev` — any DB-touching route returns 500.
- ⚠️ `variables.tf` default for `api_image` must be bumped on every push (or `-var` passed) — better handled by CI in Phase 7.

### Phase 5 — Dashboard + secrets + smoke test 🟨
- ✅ **Drizzle schema pushed to `velocap-pg-dev`** (`recordings`, `snapcap_users`). Verified via `psql \dt`.
- ✅ **`GET /api/recordings` returns real data** (`{"recordings":[],"total":0,...}`) — full stack working end-to-end from ACA → Postgres.
- ✅ Postgres admin password regenerated alphanumeric-only (previous special-char set broke URL parsing in pg driver). One-off; KV + ACA updated automatically by TF.
- ✅ **Dashboard built + deployed to `velocap-swa-dev`**:
  ```bash
  cd artifacts/snapcap-dashboard
  VITE_API_URL=https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io \
  VITE_CLERK_PUBLISHABLE_KEY=pk_test_placeholder \
  PORT=3000 BASE_PATH=/ pnpm run build
  SWA_TOKEN=$(az staticwebapp secrets list --name velocap-swa-dev --resource-group VeloCap --query properties.apiKey -o tsv)
  npx --yes @azure/static-web-apps-cli deploy ./dist/public --deployment-token "$SWA_TOKEN" --env production --no-use-keychain
  ```
  Live at https://salmon-sea-0c8c28b03.7.azurestaticapps.net (HTTP 200, serves HTML+JS+CSS).
- ⚠️ **Dashboard Clerk init will fail in-browser** until real `VITE_CLERK_PUBLISHABLE_KEY` is baked in at build time.
- ✅ Clerk keys set in KV via `az keyvault secret set` (2026-04-23)
- ✅ `MOCK_AUTH` removed from Terraform; ACA revision rolled to `671703c` image with live Clerk secrets read via KV data sources
- ✅ Dashboard rebuilt with real `VITE_CLERK_PUBLISHABLE_KEY` + redeployed to `velocap-swa-dev`
- ✅ **Browser smoke test passed** (2026-04-23). Sign-in via Clerk, `/api/recordings/stats` + `/api/recordings?limit=50` return 304 (auth-validated cached responses). CORS preflights return 204. End-to-end auth: browser Clerk session → `Authorization: Bearer <JWT>` → ACA → clerkMiddleware → requireAuth → Postgres. **Required two extra fixes beyond just setting Clerk keys:**
  - Dashboard was calling `/api/*` same-origin (no `setBaseUrl`); fixed in `main.tsx` (commit `9c9b3e4`)
  - Clerk session cookies don't cross origins; added `ClerkApiTokenBridge` in `App.tsx` to pass Clerk JWT via `Authorization` header (commit `df517a7`)
- ⬜ Remove laptop Postgres firewall rule `tareq-laptop-temp` (left in place for active dev; re-add with `az postgres flexible-server firewall-rule create -g VeloCap -n velocap-pg-dev --rule-name tareq-laptop-temp --start-ip-address $(curl -s https://api.ipify.org) --end-ip-address $(curl -s https://api.ipify.org)`)

### Phase 6 — Prod env ✅
- ✅ Created `infra/envs/prod/` composing the same 9 modules; 18 resources applied to UAE North
- ✅ ACR shared via data source; LAW / KV / Storage / Postgres / ACA env / ACA / SWA all separate (`-prod` suffix)
- ✅ Drizzle schema pushed to `velocap-pg-prod`
- ✅ Clerk secrets (same test keys for now) in `velocap-kv-prod`
- ✅ Dashboard built with prod `VITE_API_URL` + redeployed to `velocap-swa-prod`
- ✅ Smoke test: `/api/healthz` → 200; `/api/recordings` → 401 (Clerk gating working)
- ⚠️ **NODE_ENV=development** on prod ACA — Clerk Express rejects `pk_test_*`/`sk_test_*` keys when NODE_ENV=production. Flip to "production" once a live Clerk instance (`pk_live_*`) is provisioned.
- ⚠️ `tareq-laptop-temp` firewall rule added to `velocap-pg-prod` (same IP as dev)
- ⚠️ Branch push to origin blocked — Tareq has no write access to `AdhamMehdawi/Browser-Capture-Jam`. Needs collaborator invite or fork-and-PR flow.

### Phase 7 — CI/CD + alerts + extension
- 🟨 **7.1 GitHub Actions CI/CD** — workflows + runbook committed (`ca011aa`), NOT active. Blocked on: (a) Adham adding Tareq as GH collaborator, (b) Malak/Aref creating the Entra app reg + role assignments. See `infra/CICD-SETUP.md`.
- ✅ **7.2 Alerts + budget** — prod action group (emails Tareq + info), alert on ACA replicas=0 and Postgres CPU>80%/15m, $100/mo RG budget with 50/80/100% thresholds. Applied via TF, verified via `az monitor metrics alert list` + `az consumption budget list`.
- ✅ **7.3 Extension build** — release-mode dev build zipped (`velocap-extension-dev.zip`), privacy policy hosted at `/privacy.html`, CWS submission reference at `velo-qa/extension/CWS-SUBMISSION.md`.
- ✅ **7.4 App Insights SDK wired** — `applicationinsights@2.9.6` loaded via createRequire() from `artifacts/api-server/src/lib/instrumentation.ts`. Auto-collects requests / performance / exceptions / dependencies / console. Dev + prod running image `0ca187b-ai2`. Telemetry flows to `velocap-appi-{dev,prod}`.
- ⬜ 7.3b — Re-build extension for prod + re-publish once dev listing is approved and workflow is validated.

---

## Live resource snapshot

Resource group **`VeloCap`** (uaenorth):

| Resource | Name | Notes |
|---|---|---|
| Log Analytics | `velocap-law-dev` | 1 GB/day cap, 30d retention |
| App Insights | `velocap-appi-dev` | workspace-based |
| ACR | `velocapcr` | Basic, admin-enabled, **empty (no images pushed yet)** |
| Key Vault | `velocap-kv-dev` | Access-policy mode; 7 secrets |
| Storage | `velocapstdevaue01` | `assets` container created |
| Postgres | `velocap-pg-dev` | B1ms, 32 GB, no HA, database `velocap`, public + Azure-services firewall rule + **tareq-laptop-temp**. Schema pushed (`recordings`, `snapcap_users`). |
| ACA env | `velocap-cae-dev` | logs → LAW |
| Container App | `velocap-api-dev` | image `velocapcr.azurecr.io/api-server:09d89c8-fix2`; FQDN: `velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io`; `/api/healthz` returns 200 |
| Static Web App | `velocap-swa-dev` | Free; dashboard deployed; FQDN: `salmon-sea-0c8c28b03.7.azurestaticapps.net` (westeurope). Placeholder Clerk key baked in — in-browser auth will fail until rebuilt with real key. |

Resource group **`velocap-tfstate-rg`** (uaenorth):

| Resource | Name |
|---|---|
| Storage | `velocaptfstateaue01` / container `tfstate` / blob `dev.tfstate` |

## Open items / known gaps

1. ⚠️ **Sponsorship credit balance unverified** — ping Malak.
2. ⚠️ **Replit sidecar lock-in** — `artifacts/api-server/src/lib/objectStorage.ts:12` hard-codes `http://127.0.0.1:1106`. Must be replaced before backend boots on ACA. (Phase 4 task.)
3. ⚠️ **Extension ↔ API protocol mismatch** — `velo-qa/extension` calls `/auth/login` + `/jams`; api-server exposes `/api/recordings` + Clerk. Deployment works, end-to-end flow doesn't. Decision deferred — address alongside rename.
4. ⏸ **Code rename SnapCap → VeloCap** — deferred by user (focus = deploy only).
5. ⏸ **Front Door / custom domain / WAF** — deferred to post-MVP "domain day".
6. ⏸ **Postgres zone-redundant HA** — deferred; re-evaluate before real users hit prod.
7. ⏸ **Move to commercial sub (PAYG/MCA)** — required before sponsored sub sees real customer traffic (Sponsorship TOU disallows prod use).

---

## Changelog

- **2026-04-24** — Application Insights SDK wired into api-server. `createRequire()` pattern avoids an ESM interop bug where `import * as appInsights` returned a namespace missing `defaultClient`. Both envs now emit telemetry (`velocap-appi-dev`, `velocap-appi-prod`).
- **2026-04-23** — Phase 7.2 done. Prod alerts + $100/mo RG budget applied. Action group emails tareq@ + info@. Alerts for ACA replica=0 and Postgres CPU>80% sustained 15m. Budget thresholds at 50/80/100% actual.
- **2026-04-23** — Phase 7.1 assets drafted — 3 GH Actions workflows + `infra/CICD-SETUP.md` runbook committed on `deployment` branch. NOT active. Two human blockers remain (Adham → add Tareq as collaborator; Malak/Aref → create Entra app reg + assign roles).
- **2026-04-23** — Durability fix (`b584267`) deployed to dev + prod. Recordings now persist to Azure Blob; survive container restarts.
- **2026-04-23** — Extension for CWS submission: release-mode build strips localhost, name renamed `Velo QA → VeloCap` in manifest, privacy policy hosted at dashboard `/privacy.html`, zipped package + submission reference doc ready. Waiting on Tareq to finish CWS form + get review.
- **2026-04-23** — **Phase 6 done.** Prod env `envs/prod/` stood up (18 resources). ACR shared with dev via data source. Hit one gotcha: Clerk Express refuses `sk_test_*` keys when NODE_ENV=production — left prod with NODE_ENV=development until a live Clerk instance exists. Dev + prod dashboards deployed, both sign-in working with the same test Clerk instance. Branch push to origin blocked on GitHub permissions (Tareq not a collaborator on AdhamMehdawi/Browser-Capture-Jam).
- **2026-04-23** — **Phase 5 fully done.** Browser smoke test passed after two fixes: (1) `main.tsx` now calls `setBaseUrl(VITE_API_URL)` — without it, dashboard was calling relative `/api/*` which hit the SWA origin and 404'd (`9c9b3e4`). (2) Added `ClerkApiTokenBridge` in `App.tsx` to wire Clerk's `useAuth().getToken()` into the custom-fetch auth-token getter, so every API call carries `Authorization: Bearer <JWT>` (`df517a7`). Clerk session cookies don't cross the SWA↔ACA origin boundary; JWT-in-header pattern is the standard cross-origin workaround.
- **2026-04-23** — Phase 5 unpaused. Merged `origin/main` into `deployment` (merge commit `671703c`) to pick up Clerk integration. Added KV data sources so the live secret values flow into the ACA secret store on each apply. MOCK_AUTH removed; `/api/recordings` now correctly returns 401 without a Clerk session. Dashboard rebuilt with real publishable key and redeployed to SWA. Flagged: `.env` files with real `sk_test_*` key are in git history (pk_test_* matches test Clerk instance `firm-tapir-95`; rotation is a separate follow-up).
- **2026-04-22** — Dashboard built + deployed to `velocap-swa-dev` via SWA CLI. Serving HTML at https://salmon-sea-0c8c28b03.7.azurestaticapps.net. Clerk key still a placeholder — in-browser auth won't work until rebuilt with the real publishable key.
- **2026-04-22** — Phase 5 started. Drizzle schema pushed to `velocap-pg-dev`; `GET /api/recordings` returns real data end-to-end. Postgres admin password regenerated without special chars after `random_password` default tripped URL parsing in the pg driver. Laptop firewall rule `tareq-laptop-temp` added for dev-time DB access.
- **2026-04-22** — Phase 4 done. api-server image `09d89c8-fix2` pushed to `velocapcr`, running in `velocap-api-dev`, `/api/healthz` returning 200. Option A (SnapCap stack) locked after realizing velo-qa/server + snapcap-dashboard + velo-qa/extension mix wasn't coherent. Decision was triggered by the user sharing the "Summary Table" image.
- **2026-04-22** — Tracker file created. Phases 0–3 marked done retroactively based on actual applied state.
- **2026-04-21** — `infra/envs/dev` applied (19 resources). Container App on placeholder image; Postgres + KV + Storage + ACR all provisioned. Commit `2f8fa9d` on branch `deployment`.
- **2026-04-21** — Bootstrap stack applied. `velocaptfstateaue01` Storage Account created for remote Terraform state.
- **2026-04-21** — `VeloCap` and `velocap-tfstate-rg` resource groups created via `az group create`.
- **2026-04-21** — Terraform 1.14.9 installed via `brew install hashicorp/tap/terraform`.
- **2026-04-21** — Option 2 RBAC approach locked (no sub-scope role assignments).
- **2026-04-21** — All 12 design decisions locked. Deployment branch cut from `main` (`f85622d`).
