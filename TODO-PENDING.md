# VeloCap — Pending Action Items

Items that need attention before the project is fully production-ready.

---

## Critical

### 1. Clerk: Switch to live keys
- Both dev and prod currently use `pk_test_*` Clerk keys
- Provision a **live Clerk instance** with `pk_live_*` keys for prod
- Once live keys are in place, set `NODE_ENV=production` on the prod Container App
- Update `.github/workflows/deploy-prod.yml` line 29 (hardcoded test key)
- **Why:** Clerk Express SDK rejects `pk_test_*` when `NODE_ENV=production`, so these must happen together

### 2. CI/CD: Activate GitHub Actions workflows
- Workflows are committed (`.github/workflows/deploy-dev.yml` and `deploy-prod.yml`) but **dormant**
- Blocked on: **Entra (Azure AD) app registration** to create the `AZURE_CLIENT_ID` secret
- Ask Malak to set up the Entra app registration, then add the secret to the GitHub repo
- Until then, deployments are manual via `DEPLOY.md`

### 3. CWS: Fix data usage disclosures (already submitted)
- The submission is missing two required checkboxes — update in the CWS dashboard Privacy tab:
  - **User activity** — extension captures clicks, inputs, form submissions, navigations, network monitoring
  - **Web history** — extension captures page URLs, referrers, and in-session navigations
- Re-save the draft after ticking these

### 4. Azure sponsorship balance — unknown
- Malak has not confirmed the balance at https://www.microsoftazuresponsorships.com/Balance
- Risk: unknown runway, could run out unexpectedly
- **Action:** Malak to check and share the remaining credit

---

## High

### 5. Fix branch name in CICD-SETUP.md
- `infra/CICD-SETUP.md` line 11 still says `deployment` branch
- Branch was renamed to `development` — update the doc to match

### 6. .env.example files are incomplete
- `artifacts/api-server/.env.example` — missing `STORAGE_CONNECTION_STRING`, `NODE_ENV`
- `artifacts/snapcap-dashboard/.env.example` — missing `VITE_API_URL`
- These trip up new developers setting up locally

### 7. Extension: Separate dev vs prod builds
- Currently the submitted extension points at the **dev** API
- When ready for production users, build a separate extension zip with `VITE_API_URL` pointing to the **prod** API
- Consider maintaining two CWS listings (dev/test vs prod) or switching the single listing to prod when ready

---

## Medium

### 8. CWS: Add support URL
- The Chrome Web Store listing needs a **Support URL**
- Use the dashboard URL for now: `https://salmon-sea-0c8c28b03.7.azurestaticapps.net`
- Or create a dedicated support/contact page later

### 9. Prod alerts: Verify notification emails
- Alerts are configured for prod (API down, Postgres CPU high)
- Notifications go to: `tareq@menatal.com` and `info@menatal.com`
- Verify these are correct and monitored

### 10. velo-qa/.env.example is misleading
- References the old `velo-qa/server` stack (S3, JWT, NEXT.js) which is **not** the deployed stack
- The deployed stack is `artifacts/api-server` (Express + Clerk)
- Add a comment at the top clarifying this is for the alternative/reference implementation only

### 11. Hardcoded localhost in jams.ts
- `artifacts/api-server/src/routes/jams.ts` has `http://localhost:3001` in the dashboard URL response
- Currently unused (extension only consumes `recording.id`), but should be removed or made configurable

### 12. HANDOVER.md not discoverable
- Contains live credentials but is gitignored (correct for security)
- New team members won't know it exists
- Add a mention in DEPLOY.md or README explaining how to generate/obtain it

---

## Verified OK

These items were checked and are correct:

- All Azure resource names consistent across docs
- All API/dashboard URLs match actual deployments
- All Clerk key references match across files
- Extension manifest correctly strips localhost in release builds
- Extension shared/config.ts correctly uses env vars with localhost fallbacks
- Terraform variable defaults match documentation
- Database and storage account names consistent
- Extension build commands in DEPLOY.md match actual config
