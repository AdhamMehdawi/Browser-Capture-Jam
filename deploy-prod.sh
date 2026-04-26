#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VeloCap — Promote dev to PROD
# Usage:  ./deploy-prod.sh
# Run this AFTER deploy-dev.sh passes and you've verified dev.
# ============================================================

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
REGISTRY="velocapcr"
RESOURCE_GROUP="VeloCap"
API_FQDN="https://velocap-api-prod.wonderfulmoss-c389e3c8.uaenorth.azurecontainerapps.io"
CLERK_PK="pk_test_ZmlybS10YXBpci05NS5jbGVyay5hY2NvdW50cy5kZXYk"
SWA_NAME="velocap-swa-prod"

GIT_SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD)

echo "============================================"
echo "  VeloCap deploy-prod  |  commit: $GIT_SHA"
echo "============================================"
echo ""
echo "WARNING: You are deploying to PRODUCTION."
read -p "Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ----------------------------------------------------------
# Step 1: Fast-forward production branch
# ----------------------------------------------------------
echo ""
echo ">>> Step 1/5: Fast-forwarding production branch..."
CURRENT_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)
git -C "$REPO_ROOT" checkout production
git -C "$REPO_ROOT" merge --ff-only development
git -C "$REPO_ROOT" push origin production

# ----------------------------------------------------------
# Step 2: Terraform apply (same image as dev — no rebuild)
# ----------------------------------------------------------
echo ""
echo ">>> Step 2/5: Applying Terraform (prod)..."
cd "$REPO_ROOT/infra/envs/prod"
terraform apply -auto-approve \
  -var "api_image=${REGISTRY}.azurecr.io/api-server:${GIT_SHA}"

# ----------------------------------------------------------
# Step 3: API smoke test
# ----------------------------------------------------------
echo ""
echo ">>> Step 3/5: Waiting 30s for API to stabilize..."
sleep 30
echo "Smoke testing API..."
HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "${API_FQDN}/api/healthz")
if [ "$HTTP_CODE" = "200" ]; then
  echo "API health check PASSED (HTTP $HTTP_CODE)"
else
  echo "API health check FAILED (HTTP $HTTP_CODE)"
  echo "Check logs: az containerapp logs show --name velocap-api-prod --resource-group $RESOURCE_GROUP --follow"
  exit 1
fi

# ----------------------------------------------------------
# Step 4: Build & deploy dashboard to SWA
# ----------------------------------------------------------
echo ""
echo ">>> Step 4/5: Building dashboard..."
cd "$REPO_ROOT/artifacts/snapcap-dashboard"
VITE_API_URL="$API_FQDN" \
VITE_CLERK_PUBLISHABLE_KEY="$CLERK_PK" \
PORT=3000 BASE_PATH="/" \
pnpm run build

echo "Deploying dashboard to SWA..."
SWA_TOKEN=$(az staticwebapp secrets list \
  --name "$SWA_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.apiKey -o tsv)

npx --yes @azure/static-web-apps-cli deploy ./dist/public \
  --deployment-token "$SWA_TOKEN" \
  --env production \
  --no-use-keychain

# ----------------------------------------------------------
# Step 5: Switch back and summarize
# ----------------------------------------------------------
echo ""
git -C "$REPO_ROOT" checkout "$CURRENT_BRANCH"

echo "============================================"
echo "  PROD deployment complete!"
echo "============================================"
echo "  Commit:     $GIT_SHA"
echo "  API:        $API_FQDN/api/healthz"
echo "  Dashboard:  https://ambitious-wave-08351ef03.7.azurestaticapps.net"
echo "============================================"
