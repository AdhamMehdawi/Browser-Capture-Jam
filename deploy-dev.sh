#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# VeloCap — Deploy everything to DEV
# Usage:  ./deploy-dev.sh
# ============================================================

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
REGISTRY="velocapcr"
RESOURCE_GROUP="VeloCap"
API_FQDN="https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io"
CLERK_PK="pk_test_ZmlybS10YXBpci05NS5jbGVyay5hY2NvdW50cy5kZXYk"
SWA_NAME="velocap-swa-dev"

GIT_SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD)

echo "============================================"
echo "  VeloCap deploy-dev  |  commit: $GIT_SHA"
echo "============================================"

# ----------------------------------------------------------
# Step 1: Build & push API image to ACR
# ----------------------------------------------------------
echo ""
echo ">>> Step 1/5: Building API image (api-server:${GIT_SHA})..."
az acr build \
  --registry "$REGISTRY" \
  --image "api-server:${GIT_SHA}" \
  --image "api-server:latest" \
  --file "$REPO_ROOT/artifacts/api-server/Dockerfile" \
  "$REPO_ROOT"

# ----------------------------------------------------------
# Step 2: Terraform apply (update container app with new image)
# ----------------------------------------------------------
echo ""
echo ">>> Step 2/5: Applying Terraform (dev)..."
cd "$REPO_ROOT/infra/envs/dev"
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
  echo "Check logs: az containerapp logs show --name velocap-api-dev --resource-group $RESOURCE_GROUP --follow"
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
# Step 5: Summary
# ----------------------------------------------------------
echo ""
echo "============================================"
echo "  DEV deployment complete!"
echo "============================================"
echo "  Commit:     $GIT_SHA"
echo "  API:        $API_FQDN/api/healthz"
echo "  Dashboard:  https://salmon-sea-0c8c28b03.7.azurestaticapps.net"
echo "============================================"
echo ""
echo "Next steps:"
echo "  - Verify dashboard: open the URL above and sign in"
echo "  - To promote to prod: ./deploy-prod.sh"
