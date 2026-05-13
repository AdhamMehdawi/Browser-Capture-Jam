#!/usr/bin/env bash
# Switch the api-server, dashboard, and extension between LOCAL and AZURE DEV.
# Usage: ./switch-env.sh local
#        ./switch-env.sh azure
#
# What it does:
#   - Copies .env.<target> -> .env for api-server and dashboard
#   - Copies .env.<target> -> .env for the extension (consumed by `pnpm run build`)
#   - Warns about placeholder values that still need filling in
#
# After switching, restart services and rebuild the extension:
#   pnpm --filter @workspace/api-server dev
#   pnpm --filter @workspace/snapcap-dashboard dev
#   (cd velo-qa/extension && pnpm run build)

set -euo pipefail

TARGET="${1:-}"
if [[ "$TARGET" != "local" && "$TARGET" != "azure" ]]; then
  echo "usage: $0 local|azure" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"

swap() {
  local dir="$1"
  local src="$dir/.env.$TARGET"
  local dst="$dir/.env"
  if [[ ! -f "$src" ]]; then
    echo "  [skip] $src not found" >&2
    return
  fi
  cp "$src" "$dst"
  echo "  [ok]   $(realpath --relative-to="$ROOT" "$dst" 2>/dev/null || echo "$dst") <- .env.$TARGET"
}

echo "Switching to: $TARGET"
swap "$ROOT/artifacts/api-server"
swap "$ROOT/artifacts/snapcap-dashboard"
swap "$ROOT/velo-qa/extension"

# Flag any unfilled placeholders.
PLACEHOLDERS=$(grep -l "__FILL_FROM_KEYVAULT__" \
  "$ROOT/artifacts/api-server/.env" \
  "$ROOT/artifacts/snapcap-dashboard/.env" \
  "$ROOT/velo-qa/extension/.env" 2>/dev/null || true)

if [[ -n "$PLACEHOLDERS" ]]; then
  echo
  echo "⚠️  Placeholder values still need filling in:"
  echo "$PLACEHOLDERS" | sed 's/^/    /'
  echo
  echo "    For STORAGE_CONNECTION_STRING (api-server azure preset):"
  echo "    az login --tenant malakalsaffarthejumpapp.onmicrosoft.com"
  echo "    az keyvault secret show --vault-name velocap-kv-dev \\"
  echo "      --name storage-connection-string --query value -o tsv"
fi

echo
echo "Next steps:"
echo "  - Restart api-server / dashboard if they're running (env is read at startup)"
echo "  - Rebuild the extension: (cd velo-qa/extension && pnpm run build)"
