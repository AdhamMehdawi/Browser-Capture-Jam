# VeloCap — Local development guide

How to clone the repo and run the full stack on your laptop in ~5 minutes. Pairs with `DEPLOY.md` (cloud) and `DEPLOYMENT-RECAP.md` (history).

---

## Prerequisites

```bash
# Tools
brew install azure-cli node pnpm

# Verify
node -v   # >= 24
pnpm -v   # >= 10
```

You also need to be logged into Azure as someone with read access to the dev Key Vault, OR your team needs to share a `.env` file with you out-of-band.

```bash
az login --tenant malakalsaffarthejumpapp.onmicrosoft.com
az account set --subscription fb42fb29-4fcc-40a9-9ff0-21ef191674af
```

---

## Setup (first time)

```bash
git clone https://github.com/AdhamMehdawi/Browser-Capture-Jam.git
cd Browser-Capture-Jam
git checkout development

pnpm install
(cd velo-qa && pnpm install)   # extension uses a nested pnpm workspace
```

### Pull dev secrets into local `.env` files

The api-server and dashboard each have a `.env.example` showing required variables. Run these to populate real values from Azure Key Vault into your local `.env` files (NEVER commit them):

```bash
DB_URL=$(az keyvault secret show --vault-name velocap-kv-dev --name database-url --query value -o tsv)
STORAGE=$(az keyvault secret show --vault-name velocap-kv-dev --name storage-connection-string --query value -o tsv)
CLERK_SK=$(az keyvault secret show --vault-name velocap-kv-dev --name clerk-secret-key --query value -o tsv)
CLERK_PK=$(az keyvault secret show --vault-name velocap-kv-dev --name clerk-publishable-key --query value -o tsv)

cat > artifacts/api-server/.env <<EOF
DATABASE_URL=$DB_URL
STORAGE_CONNECTION_STRING=$STORAGE
CLERK_SECRET_KEY=$CLERK_SK
CLERK_PUBLISHABLE_KEY=$CLERK_PK
PORT=4000
NODE_ENV=development
EOF

cat > artifacts/snapcap-dashboard/.env <<EOF
VITE_API_URL=http://localhost:4000
VITE_CLERK_PUBLISHABLE_KEY=$CLERK_PK
EOF
```

The dev Postgres firewall is currently open to 0.0.0.0 so any laptop can connect. (When that gets locked back down, your laptop's IP will need to be added — see `DEPLOY.md` Op 6.)

---

## Run everything

From the repo root, one command:

```bash
pnpm dev
```

This launches both processes in parallel using `concurrently`. You'll see colour-coded logs:

- **`[api]`** — api-server on http://localhost:4000 (hot-reload via `tsx watch`)
- **`[dashboard]`** — Vite dev server on http://localhost:3001 (hot-reload built-in)

Open http://localhost:3001 in your browser. Sign in with Clerk. The dashboard talks to your local api-server, which talks to the **dev Azure Postgres + Blob Storage**.

To stop: `Ctrl+C` once stops both.

---

## Run only one piece

If you only need the backend (e.g. testing API changes with curl/Postman):

```bash
pnpm --filter @workspace/api-server dev
```

If you only need the dashboard (e.g. styling work, can hit the deployed dev backend instead of running one locally):

```bash
# Edit artifacts/snapcap-dashboard/.env first:
#   VITE_API_URL=https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io
pnpm --filter @workspace/snapcap-dashboard dev
```

---

## Verify it's working

In another terminal:

```bash
# Backend healthz
curl -sS http://localhost:4000/api/healthz
# → {"status":"ok"}

# Backend with auth (will be 401 without Clerk session)
curl -sS http://localhost:4000/api/recordings
# → {"error":"Unauthorized"}
```

In the browser:

1. Open http://localhost:3001
2. Click sign in
3. Clerk modal appears (using the test instance `firm-tapir-95`)
4. Sign in with any email — Clerk emails a verification code
5. Dashboard loads, recordings list appears (empty for new accounts)

---

## Loading the extension locally

```bash
# Build the extension pointing at your local backend
cd velo-qa/extension
VITE_API_URL=http://localhost:4000/api \
VITE_DASHBOARD_URL=http://localhost:3001 \
pnpm run build
```

Then in Chrome:

1. `chrome://extensions`
2. Toggle Developer mode (top-right)
3. Click **Load unpacked**
4. Select `velo-qa/extension/dist/`
5. The extension icon appears in the toolbar

For the extension to authenticate, you'd need the dashboard's `/extension-auth` page running locally too — already covered when you ran `pnpm dev`.

> Note: Chrome won't allow recording on `chrome://`, the new tab page, or the Web Store itself. Open any normal site (e.g. https://example.com) before clicking Record.

---

## Common issues

### `Connection refused` when starting backend
Postgres firewall might have been re-locked. Check at https://portal.azure.com → Postgres → Networking → Firewall rules. Add your IP:
```bash
MY_IP=$(curl -s https://api.ipify.org)
az postgres flexible-server firewall-rule create \
  --resource-group VeloCap --name velocap-pg-dev \
  --rule-name "$(whoami)-laptop" \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
```

### Clerk init error in browser
The publishable key in `artifacts/snapcap-dashboard/.env` is empty or wrong. Re-run the secret-pull commands at the top of this file.

### Dashboard 404s on `/dashboard`
You're hitting the prod static-deploy without the SPA fallback rule. For LOCAL dev this never happens (Vite dev server handles SPA routing automatically). If it appears, you're accidentally hitting a deployed URL — check `VITE_API_URL`.

### `EACCES /repo/artifacts/api-server/.data/media` from /jams route
Old code path that wrote to local disk. Already patched in main. If you see it, you're on an old commit — `git pull origin development`.

### `Cannot find module 'tsx'`
You forgot `pnpm install` after pulling. Run it.

### Cross-origin / CORS errors
Verify your dashboard `.env` has `VITE_API_URL=http://localhost:4000` (not the Azure URL) when running locally. Otherwise the browser tries to talk to the Azure backend directly with localhost origin, which CORS will reject.

---

## What's NOT included locally

- Azure Application Insights — local code won't send telemetry (env var not set, intentionally)
- Production Clerk keys — we use the dev test instance everywhere
- Real customer data — both envs are sandboxes

---

## Next steps for a polished local-dev experience (not done yet)

These are nice-to-haves we deferred:

- A `docker-compose.yml` that spins up local Postgres + Azurite (offline-capable)
- A `.env.example`-only pattern with `.env` strictly per-developer
- Test setup (vitest is the obvious pick)
- ESLint + pre-commit hooks via husky + lint-staged

Open an issue or add to `infra/TRACKER.md` "open items" if you want one of these prioritized.

---

## TL;DR cheat-sheet

```bash
git clone https://github.com/AdhamMehdawi/Browser-Capture-Jam.git
cd Browser-Capture-Jam && git checkout development
pnpm install
(cd velo-qa && pnpm install)

# pull secrets (see "Setup (first time)" above for full block)
# create artifacts/api-server/.env and artifacts/snapcap-dashboard/.env

pnpm dev
# → api at http://localhost:4000
# → dashboard at http://localhost:3001
```
