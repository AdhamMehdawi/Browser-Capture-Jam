# VeloCap — Manual Deployment Runbook

Day-to-day operations guide for deploying and maintaining VeloCap on Azure
without CI/CD. Every command here is copy-paste-ready. Read top to bottom
the first time; bookmark the sections you'll repeat.

---

## At a glance

**What's deployed**

| Component | Dev | Prod |
|---|---|---|
| Backend (`api-server`) | `https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io` | `https://velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io` |
| Dashboard | `https://salmon-sea-0c8c28b03.7.azurestaticapps.net` | `https://ambitious-wave-08351ef03.7.azurestaticapps.net` |
| Postgres | `velocap-pg-dev.postgres.database.azure.com` | `velocap-pg-prod.postgres.database.azure.com` |
| Storage | `velocapstdevaue01` | `velocapstprodaue01` |
| Key Vault | `velocap-kv-dev` | `velocap-kv-prod` |
| App Insights | `velocap-appi-dev` | `velocap-appi-prod` |
| Container Registry | `velocapcr` (shared) | (same) |
| Resource Group | `VeloCap` | (same) |
| TF state | `velocaptfstateaue01/tfstate/dev.tfstate` | `…/prod.tfstate` |

**Subscription / tenant**
- Subscription: `The JUMP App Subscription` · `fb42fb29-4fcc-40a9-9ff0-21ef191674af` · Sponsorship
- Tenant: `malakalsaffarthejumpapp.onmicrosoft.com` · `0451fcf1-2dd9-4eff-90e3-8396b9df62d9`
- Region: `uaenorth`

**People**
- Deployer: `tareq@menatal.com` (Azure Contributor)
- Owners (Azure + Entra admin): `malakalsaffar@thejumpapp.org`, `aref@menatal.com`
- Repo owner: `AdhamMehdawi` on GitHub

---

## Prerequisites (one-time machine setup)

### Install tools
```bash
brew install azure-cli node pnpm
brew tap hashicorp/tap && brew install hashicorp/tap/terraform
```

Verify:
```bash
az version
terraform version           # >= 1.9
node -v                     # >= 24
pnpm -v                     # >= 10
```

### Log into Azure
```bash
az login --tenant malakalsaffarthejumpapp.onmicrosoft.com
az account set --subscription fb42fb29-4fcc-40a9-9ff0-21ef191674af
az account show --query "{name:name,user:user.name}" -o table
```
You should see your email and "The JUMP App Subscription".

### Clone + install
```bash
git clone https://github.com/AdhamMehdawi/Browser-Capture-Jam.git
cd Browser-Capture-Jam
pnpm install
```

For the extension subworkspace:
```bash
cd velo-qa && pnpm install && cd -
```

### Initialize Terraform (each env, once per machine)
```bash
(cd infra/envs/dev && terraform init)
(cd infra/envs/prod && terraform init)
```

You're ready to deploy.

---

## Operation 1 — Deploy api-server changes (dev)

Use this when you've changed code under `artifacts/api-server/**` or `lib/**`.

```bash
# 1. Commit the change to the deployment branch
git checkout deployment
git add artifacts/api-server/
git commit -m "your change description"

# 2. Build the image in ACR (no local Docker needed)
GIT_SHA=$(git rev-parse --short HEAD)
az acr build \
  --registry velocapcr \
  --image "api-server:${GIT_SHA}" \
  --image "api-server:latest" \
  --file artifacts/api-server/Dockerfile \
  .

# 3. Bump the image tag in dev's variables.tf
# Edit infra/envs/dev/variables.tf — change the api_image default to:
#   "velocapcr.azurecr.io/api-server:${GIT_SHA}"
# (or just pass -var on the next command)

# 4. Apply
cd infra/envs/dev
terraform apply -auto-approve \
  -var "api_image=velocapcr.azurecr.io/api-server:${GIT_SHA}"

# 5. Smoke test
sleep 30
curl -sS -w "\nHTTP %{http_code}\n" \
  https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io/api/healthz
```

Expected: `{"status":"ok"}` · `HTTP 200`.

If anything fails → see [Troubleshooting](#troubleshooting).

---

## Operation 2 — Promote dev to prod

After dev passes smoke test, promote the **same image digest** to prod.

```bash
GIT_SHA=$(git rev-parse --short HEAD)   # the same SHA you deployed to dev

cd infra/envs/prod
terraform apply -auto-approve \
  -var "api_image=velocapcr.azurecr.io/api-server:${GIT_SHA}"

sleep 30
curl -sS -w "\nHTTP %{http_code}\n" \
  https://velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io/api/healthz
```

Then commit the variable bump on the branch:
```bash
git add infra/envs/dev/variables.tf infra/envs/prod/variables.tf
git commit -m "infra: bump api_image to ${GIT_SHA}"
git push
```

---

## Operation 3 — Deploy dashboard changes (dev)

```bash
cd artifacts/snapcap-dashboard

VITE_API_URL="https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io" \
VITE_CLERK_PUBLISHABLE_KEY="pk_test_ZmlybS10YXBpci05NS5jbGVyay5hY2NvdW50cy5kZXYk" \
PORT=3000 BASE_PATH="/" \
pnpm run build

SWA_TOKEN=$(az staticwebapp secrets list \
  --name velocap-swa-dev \
  --resource-group VeloCap \
  --query properties.apiKey -o tsv)

npx --yes @azure/static-web-apps-cli deploy ./dist/public \
  --deployment-token "$SWA_TOKEN" \
  --env production \
  --no-use-keychain
```

Verify: open `https://salmon-sea-0c8c28b03.7.azurestaticapps.net/` — sign in with Clerk, recordings list loads.

---

## Operation 4 — Deploy dashboard to prod

Same as Op 3 but swap the env URLs:

```bash
VITE_API_URL="https://velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io" \
VITE_CLERK_PUBLISHABLE_KEY="pk_test_ZmlybS10YXBpci05NS5jbGVyay5hY2NvdW50cy5kZXYk" \
PORT=3000 BASE_PATH="/" \
pnpm run build

SWA_TOKEN=$(az staticwebapp secrets list --name velocap-swa-prod --resource-group VeloCap --query properties.apiKey -o tsv)
npx --yes @azure/static-web-apps-cli deploy ./dist/public --deployment-token "$SWA_TOKEN" --env production --no-use-keychain
```

---

## Operation 5 — Apply an infra change

```bash
# 1. Edit the .tf file (modules/* or envs/dev or envs/prod)

# 2. Plan to see what will change
cd infra/envs/dev   # or envs/prod
terraform plan

# 3. If the plan is correct, apply
terraform apply -auto-approve

# 4. Commit
cd ../../..
git add infra/
git commit -m "infra: <what changed>"
git push
```

**Always** plan before apply on prod. Read every line of the diff.

---

## Operation 6 — Push DB schema changes

When you change `lib/db/src/schema/*`:

```bash
# 1. Add your laptop IP to Postgres firewall (one-time per IP)
MY_IP=$(curl -s https://api.ipify.org)
az postgres flexible-server firewall-rule create \
  --resource-group VeloCap \
  --name velocap-pg-dev \
  --rule-name tareq-laptop-temp \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP"

# 2. Pull DATABASE_URL from KV
export DATABASE_URL="$(az keyvault secret show \
  --vault-name velocap-kv-dev \
  --name database-url \
  --query value -o tsv)"

# 3. Push schema
pnpm --filter @velocap/db run push   # or @workspace/db pre-rename
```

For prod, swap `velocap-pg-dev` / `velocap-kv-dev` with `-prod` variants.

**Remove the firewall rule when you're done:**
```bash
az postgres flexible-server firewall-rule delete \
  --resource-group VeloCap \
  --name velocap-pg-dev \
  --rule-name tareq-laptop-temp -y
```

---

## Operation 7 — Rotate / update a secret

```bash
# Update the KV secret out-of-band
az keyvault secret set \
  --vault-name velocap-kv-dev \
  --name clerk-secret-key \
  --value "sk_test_NEW_VALUE_HERE"

# Re-apply Terraform — KV data sources read the new value and propagate
# to ACA's secret store
cd infra/envs/dev
terraform apply -auto-approve

# ACA auto-creates a new revision with the new value
```

Same flow for `velocap-kv-prod` + `infra/envs/prod`.

---

## Operation 8 — Build the extension

### For local dev testing (load unpacked)
```bash
cd velo-qa/extension
VITE_API_URL="https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io/api" \
VITE_DASHBOARD_URL="https://salmon-sea-0c8c28b03.7.azurestaticapps.net" \
pnpm run build
```
Then in Chrome → `chrome://extensions` → Developer mode on → Load unpacked → pick `velo-qa/extension/dist/`.

### For Chrome Web Store (release-mode, dev backend)
```bash
cd velo-qa/extension
EXT_BUILD_MODE=release \
VITE_API_URL="https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io/api" \
VITE_DASHBOARD_URL="https://salmon-sea-0c8c28b03.7.azurestaticapps.net" \
pnpm run build

cd dist
rm -f ../../../velocap-extension-dev.zip
zip -qr ../../../velocap-extension-dev.zip .
cd -

ls -lh ../../velocap-extension-dev.zip
```
Upload the resulting `velocap-extension-dev.zip` to https://chrome.google.com/webstore/devconsole. See `velo-qa/extension/CWS-SUBMISSION.md` for the listing fields.

### For Chrome Web Store (release-mode, prod backend)
Same as above but with prod URLs:
```bash
EXT_BUILD_MODE=release \
VITE_API_URL="https://velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io/api" \
VITE_DASHBOARD_URL="https://ambitious-wave-08351ef03.7.azurestaticapps.net" \
pnpm run build
```

After every meaningful change, bump the `version` in `velo-qa/extension/src/manifest.config.ts` (semver).

---

## Operation 9 — Pause Postgres to save sponsorship credit

When you'll be away for a few days and don't need either env running:

```bash
az postgres flexible-server stop -n velocap-pg-dev -g VeloCap
az postgres flexible-server stop -n velocap-pg-prod -g VeloCap
```
Stops billing for compute (storage still bills, but minor). Auto-resumes after 7 days max.

Resume:
```bash
az postgres flexible-server start -n velocap-pg-dev -g VeloCap
az postgres flexible-server start -n velocap-pg-prod -g VeloCap
```

---

## Operation 10 — Tear it all down (if you ever need to)

⚠️ **Destructive.** Removes both envs.

```bash
cd infra/envs/dev && terraform destroy
cd ../prod && terraform destroy
cd ../../bootstrap && terraform destroy   # only if you want to remove the state SA too
```

The `VeloCap` and `velocap-tfstate-rg` RGs survive — delete them manually in the Portal if needed.

---

## Verification

### Backend healthy
```bash
curl -sS https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io/api/healthz
curl -sS https://velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io/api/healthz
```
Both should return `{"status":"ok"}`.

### Backend gating Clerk correctly
```bash
curl -sS -w "\nHTTP %{http_code}\n" https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io/api/recordings
```
Should return `HTTP 401` (no Clerk session).

### Dashboard loads + signs in
Open the URL in a browser, sign in via Clerk, dashboard list shows.

### Recordings persist (durability)
After recording a jam:
```bash
az storage blob list \
  --account-name velocapstdevaue01 \
  --container-name assets \
  --prefix objects/ \
  --query "[].{name:name,size:properties.contentLength,created:properties.creationTime}" \
  -o table --auth-mode key
```
You should see `objects/<uuid>.webm` blobs from your recording sessions.

### Telemetry flowing to App Insights
Azure Portal → Application Insights → `velocap-appi-dev` → Live Metrics. Hit a few endpoints; you should see live request counts within ~5 seconds.

### Alerts armed
Azure Portal → Monitor → Alerts. Filter by Resource group `VeloCap`. Should see `velocap-alert-api-down-prod` and `velocap-alert-pg-cpu-prod` listed.

### Budget tracking
Azure Portal → Cost Management → Budgets → `velocap-monthly-budget`. Shows current spend / $100.

---

## Troubleshooting

### Container app revision is "Unhealthy" / "ActivationFailed"
1. Get the failing revision name:
   ```bash
   az containerapp revision list -n velocap-api-dev -g VeloCap \
     --query "[?properties.healthState=='Unhealthy'].name" -o tsv
   ```
2. Read its console logs:
   ```bash
   WORKSPACE_ID=$(az monitor log-analytics workspace show -g VeloCap -n velocap-law-dev --query customerId -o tsv)
   az monitor log-analytics query --workspace "$WORKSPACE_ID" \
     --analytics-query "ContainerAppConsoleLogs_CL | where RevisionName_s == 'velocap-api-dev--XXXX' | project TimeGenerated, Log_s | order by TimeGenerated asc | take 50" \
     -o tsv | tail -50
   ```
3. Common causes we've actually hit:
   - **`Cannot find module '/repo/.../thread-stream-worker.mjs'`** → Dockerfile WORKDIR doesn't match build path. The runtime stage must use `WORKDIR /repo/artifacts/api-server`.
   - **`appInsights.defaultClient is undefined`** → ESM/CJS interop bug. Use `createRequire` in `instrumentation.ts`, not `import * as`.
   - **`Insufficient privileges to complete the operation`** during deploy → Tareq lost Contributor on the RG. Reapply.
   - **`Clerk middleware error: key not valid`** with `NODE_ENV=production` and `pk_test_*` keys → Clerk Express rejects test keys in production mode. Set `NODE_ENV=development` for now (until live Clerk keys are provisioned).

### Postgres `TypeError: Invalid URL` on schema push
The admin password contains URL-unsafe characters. The current password generator (`infra/envs/{dev,prod}/main.tf`) has `special = false` exactly to prevent this — if you ever flip it back to `special = true`, expect this break.

### Dashboard 404 on `/dashboard`, `/recordings/:id`, `/extension-auth`
SPA fallback isn't configured. Make sure `artifacts/snapcap-dashboard/public/staticwebapp.config.json` exists and contains the `navigationFallback` rule. Rebuild + redeploy.

### `/api/recordings` returns 401 even after Clerk sign-in
The dashboard isn't sending the Clerk JWT. Verify:
- `artifacts/snapcap-dashboard/src/main.tsx` calls `setBaseUrl(import.meta.env.VITE_API_URL)`.
- `artifacts/snapcap-dashboard/src/App.tsx` includes `<ClerkApiTokenBridge />` inside `<ClerkProvider>`.
- Check the browser Network tab → request headers contain `authorization: Bearer eyJ...`.

### `[ai] Application Insights initialized` doesn't appear in logs
The instrumentation import was tree-shaken or never ran:
- `artifacts/api-server/src/index.ts` must include `import "./lib/instrumentation";` near the top.
- `artifacts/api-server/build.mjs` externals must include `applicationinsights`, `diagnostic-channel`, `diagnostic-channel-publishers`.
- After fixing, run `pnpm --filter @workspace/api-server run build`, then check `grep -c "Application Insights initialized" artifacts/api-server/dist/index.mjs` — should be `1`.

### `terraform apply` fails with `Failed to get existing workspaces: 403`
Your TF backend is misconfigured to use Azure AD auth. Make sure `infra/envs/{dev,prod}/backend.tf` does **not** include `use_azuread_auth = true`. Without it, the backend uses shared keys (which Tareq's Contributor can read).

### Recording uploads but video doesn't play in dashboard
- Check the blob actually landed:
  ```bash
  az storage blob list --account-name velocapstdevaue01 --container-name assets --prefix objects/ -o table --auth-mode key
  ```
- If blob is there but dashboard says "no video": check `recordings.tsx` — `videoUrl` should be `${apiBase}/api/storage${recording.videoObjectPath}`.
- If blob is missing: check api-server logs for `[jams] Blob upload failed`. Likely `STORAGE_CONNECTION_STRING` env var is wrong or KV secret is stale.

### Sponsorship credit running low
Malak checks https://www.microsoftazuresponsorships.com/Balance. If runway < 1 month, options:
1. Pause Postgres (Op 9) when not actively developing — saves ~70% of dev cost.
2. Drop Container App `min_replicas` to 0 in prod — accept cold starts.
3. Migrate the sub to a commercial PAYG/MCA before credits run out.

---

## Reference

### Naming convention
Lowercase token `velocap` + service suffix + env. Example: `velocap-pg-dev`, `velocap-kv-prod`, `velocapstprodaue01`.

### KV secrets (per env)
| Name | Purpose |
|---|---|
| `database-url` | Full Postgres connection string |
| `postgres-admin-password` | Just the password |
| `storage-connection-string` | Azure Blob connection |
| `acr-admin-password` | For ACA to pull images |
| `appi-connection-string` | App Insights ingestion |
| `clerk-secret-key` | Clerk Express middleware |
| `clerk-publishable-key` | Frontend Clerk init (also baked into Vite build) |

### Image tag convention
`velocapcr.azurecr.io/api-server:<git-short-sha>` — never use `:latest` for prod deploys, only for transient testing.

### People + access
| Person | What they can do |
|---|---|
| `tareq@menatal.com` | Contributor on sub. All resource ops. **You.** |
| `adham@menatal.com` | GitHub repo owner. Source-of-truth for code. |
| `malakalsaffar@thejumpapp.org` | Owner on sub + Entra admin. Needed for app registrations, sub-scope role assignments, sponsorship balance. |
| `aref@menatal.com` | Owner on sub. Same as Malak. |

### Documents in this repo
| Doc | When to read |
|---|---|
| `DEPLOY.md` (this file) | Day-to-day operations. |
| `infra/TRACKER.md` | Current state + history of every infra change. Update after each meaningful action. |
| `infra/CICD-SETUP.md` | When you're ready to activate GitHub Actions auto-deploys. Skip until then. |
| `velo-qa/extension/CWS-SUBMISSION.md` | When updating the Chrome Web Store listing. |

---

## When to revisit CI/CD

Manual deploys via this runbook are fine until any of:
- 5+ deploys per week (the per-deploy minutes add up)
- 3+ developers (multiple people need to deploy)
- Customer SLA / on-call rotation (audit trail becomes important)
- Compliance requirement for separation-of-duties

When that happens, follow `infra/CICD-SETUP.md` — the workflows are already written and committed; only Adham (collab grant — done) + Malak (Entra app reg — pending) need to act.

---

## Cheatsheet — most common ops

```bash
# Deploy api change to dev
GIT_SHA=$(git rev-parse --short HEAD)
az acr build --registry velocapcr --image "api-server:${GIT_SHA}" --image "api-server:latest" --file artifacts/api-server/Dockerfile .
(cd infra/envs/dev && terraform apply -auto-approve -var "api_image=velocapcr.azurecr.io/api-server:${GIT_SHA}")

# Deploy dashboard to dev
(cd artifacts/snapcap-dashboard && \
 VITE_API_URL=https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io \
 VITE_CLERK_PUBLISHABLE_KEY=pk_test_ZmlybS10YXBpci05NS5jbGVyay5hY2NvdW50cy5kZXYk \
 PORT=3000 BASE_PATH=/ \
 pnpm run build)
SWA_TOKEN=$(az staticwebapp secrets list --name velocap-swa-dev --resource-group VeloCap --query properties.apiKey -o tsv)
(cd artifacts/snapcap-dashboard && npx --yes @azure/static-web-apps-cli deploy ./dist/public --deployment-token "$SWA_TOKEN" --env production --no-use-keychain)

# Health check
curl -sS https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io/api/healthz
curl -sS https://velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io/api/healthz
```
