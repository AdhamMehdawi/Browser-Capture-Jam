# VeloCap — CI/CD setup runbook

One-time steps to wire GitHub Actions into Azure using **OIDC federated credentials** (no secrets stored in GitHub). After this is done, pushes to `development` deploy to dev automatically, and pushes to `production` deploy to prod (gated by required-reviewer approval).

---

## Prerequisites (who does what)

| Step | Who must do it | Why |
|---|---|---|
| 1. Add Tareq as collaborator on `AdhamMehdawi/Browser-Capture-Jam` | **Adham** | So the `deployment` branch can be pushed and workflow files can live on origin |
| 2. Create Entra app registration + federated credentials | **Malak or Aref** (Application Administrator / Global Admin in Entra) | Tareq lacks directory role to create app regs |
| 3. Assign `Contributor` to the new SP on both RGs + `Storage Blob Data Contributor` on the tfstate SA | **Malak or Aref** (Owner on sub or User Access Admin) | Tareq is Contributor, can't assign roles |
| 4. Add repo secrets on GitHub + push the `.github/workflows/` files | **Tareq** (after steps 1–3) | Regular dev work once the identity exists |

---

## Step 2 — commands for Malak / Aref (copy-paste)

```bash
# Run from anywhere; `az` must be logged in as Malak or Aref
SUB="fb42fb29-4fcc-40a9-9ff0-21ef191674af"
TENANT="0451fcf1-2dd9-4eff-90e3-8396b9df62d9"
REPO="AdhamMehdawi/Browser-Capture-Jam"

# --- create app registration ---
APP_ID=$(az ad app create \
  --display-name "velocap-gh-oidc" \
  --query appId -o tsv)

# --- create service principal backing the app ---
SP_OBJECT_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)

echo "APP_ID=$APP_ID"
echo "SP_OBJECT_ID=$SP_OBJECT_ID"
echo "TENANT_ID=$TENANT"
echo "SUBSCRIPTION_ID=$SUB"
# ^^^ paste these four to Tareq — he needs them for GitHub repo secrets

# --- federated credentials: one per GitHub subject claim ---
# (Wildcards not supported; each trigger needs its own credential.)

# Pushes to `development` branch (auto-deploy to dev)
az ad app federated-credential create --id "$APP_ID" --parameters "$(cat <<EOF
{
  "name": "gh-development-branch",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${REPO}:ref:refs/heads/development",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
)"

# Pushes to `production` branch (auto-deploy to prod, with required-reviewer gate)
az ad app federated-credential create --id "$APP_ID" --parameters "$(cat <<EOF
{
  "name": "gh-production-branch",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${REPO}:ref:refs/heads/production",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
)"

# Pull requests (plan-only)
az ad app federated-credential create --id "$APP_ID" --parameters "$(cat <<EOF
{
  "name": "gh-pull-request",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${REPO}:pull_request",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
)"

# Prod environment (manual dispatch with environment protection)
az ad app federated-credential create --id "$APP_ID" --parameters "$(cat <<EOF
{
  "name": "gh-env-prod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${REPO}:environment:prod",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF
)"

# --- role assignments ---
az role assignment create --assignee "$APP_ID" --role "Contributor" \
  --scope "/subscriptions/${SUB}/resourceGroups/VeloCap"
az role assignment create --assignee "$APP_ID" --role "Contributor" \
  --scope "/subscriptions/${SUB}/resourceGroups/velocap-tfstate-rg"

# Data-plane role on the TF state storage account — lets the azurerm
# backend use Azure AD auth instead of shared keys (tighter security).
az role assignment create --assignee "$APP_ID" --role "Storage Blob Data Contributor" \
  --scope "/subscriptions/${SUB}/resourceGroups/velocap-tfstate-rg/providers/Microsoft.Storage/storageAccounts/velocaptfstateaue01"

echo ""
echo "✅ Done. Send APP_ID + TENANT + SUB to Tareq; he'll set them as"
echo "   repo secrets in GitHub."
```

---

## Step 4 — GitHub repo setup (Tareq does, after step 2 is done)

### 4a. Add repo secrets
In GitHub → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret name | Value |
|---|---|
| `AZURE_CLIENT_ID` | The `APP_ID` Malak sent |
| `AZURE_TENANT_ID` | `0451fcf1-2dd9-4eff-90e3-8396b9df62d9` |
| `AZURE_SUBSCRIPTION_ID` | `fb42fb29-4fcc-40a9-9ff0-21ef191674af` |

These are **non-sensitive routing keys**; they could also be GitHub "Variables" instead of Secrets, but Secrets works fine.

### 4b. Create the `prod` environment
GitHub → Settings → Environments → **New environment** → name it **`prod`**.
- Enable **Required reviewers** → add yourself and/or Adham. This means the prod workflow pauses for explicit approval before deploying.
- Optionally add a wait timer.

### 4c. Push the workflows
The `.github/workflows/` folder exists on the `development` branch. Once Tareq has push access:
```bash
git push -u origin development
git push -u origin production
```
The first workflow run triggers on the push.

---

## What the workflows do

| File | Trigger | What it does |
|---|---|---|
| `terraform-plan.yml` | PR against `main` touching `infra/**` | `terraform plan` on dev + prod, posts diff as a PR comment |
| `deploy-dev.yml` | Push to `development` touching `artifacts/api-server/**`, `lib/**`, `artifacts/snapcap-dashboard/**`, or `infra/envs/dev/**` | Builds changed piece(s), pushes new api image to ACR, applies TF dev, rebuilds/redeploys dashboard to dev SWA |
| `deploy-prod.yml` | Push to `production` (or `workflow_dispatch` with optional image-tag) | Same as dev but for prod, gated by the `prod` GitHub environment's required-reviewers approval |

---

## Verifying after step 4

1. Push a small commit to `development`
2. `deploy-dev.yml` runs; should complete green
3. Open a PR changing anything under `infra/`; `terraform-plan.yml` comments the plan
4. Merge `development` → `production` (PR or fast-forward); `deploy-prod.yml` triggers, paused for reviewer approval; approve → deploys to prod

If a step fails, the logs in the GitHub Actions run show exactly which `az`/`terraform` call broke.
