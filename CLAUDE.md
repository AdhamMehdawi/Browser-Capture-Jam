# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Big picture

VeloCap / SnapCap is a Jam.dev-style bug capture tool: a Chrome extension records screen video + console + network + clicks, uploads the bytes directly to Azure Blob via SAS URL, and a React dashboard replays each session. There are three deployable artifacts and a shared `lib/` layer; a single OpenAPI spec is the source of truth that wires the backend to the dashboard client.

```
┌─ velo-qa/extension ─────────┐   direct upload (SAS)   ┌─ Azure Blob ─┐
│ MV3 service worker + offscreen│ ─────────────────────► │              │
│ doc records via MediaRecorder │                        └──────────────┘
└─────────┬───────────────────┘
          │  POST /uploads/init → /uploads/complete (metadata only)
          ▼
┌─ artifacts/api-server ──────┐   Drizzle ORM      ┌─ Azure Postgres ─┐
│ Express 5 + Clerk           │ ─────────────────► │ recordings,      │
│ requireAuth: Clerk or sc_   │                    │ snapcap_users    │
│ API key or JWT              │                    └──────────────────┘
└─────────┬───────────────────┘
          │  /api/* (JWT bearer)
          ▼
┌─ artifacts/snapcap-dashboard ┐
│ React 19 + Vite + Wouter +   │
│ TanStack Query + Clerk + Plyr│
└──────────────────────────────┘
```

### OpenAPI is the contract

`lib/api-spec/openapi.yaml` is the **single source of truth**. Orval generates two consumer packages from it:

- `lib/api-zod/` — zod schemas + TS types (consumed by `api-server`)
- `lib/api-client-react/` — typed TanStack Query hooks + a `customFetch` mutator (consumed by `snapcap-dashboard`)

When changing API shape: edit `openapi.yaml`, regenerate, then fix the two known footguns below.

**Footgun 1: Orval clobbers `lib/api-zod/src/index.ts`.** After every codegen run, rewrite that file to a single line:
```ts
export * from "./generated/api";
```
Otherwise the duplicate export Orval emits breaks the build.

**Footgun 2: TanStack Query + `enabled` needs an explicit `queryKey`.** When using a generated hook with conditional `enabled`, also pass the matching `queryKey` helper:
```ts
useGetThing(id, { query: { enabled: !!id, queryKey: getGetThingQueryKey(id) } })
```

### Auth resolution

`artifacts/api-server/src/middlewares/requireAuth.ts` is the single auth surface. It accepts:
1. Clerk session cookie (dashboard, same Clerk instance via `clerkProxyMiddleware`)
2. `Authorization: Bearer sc_…` API key (extension, programmatic clients — stored on `snapcap_users.apiKey`)
3. `Authorization: Bearer <clerk JWT>` (extension after dashboard hand-off)
4. `MOCK_AUTH=true` or missing `CLERK_SECRET_KEY` → `demo_user` (local dev only)

The dashboard bridges Clerk's session into `customFetch` via `setAuthTokenGetter` (see [App.tsx:139](artifacts/snapcap-dashboard/src/App.tsx#L139)). Public routes (`/api/healthz`, `/api/share/*`, `/api/storage/*`) bypass Clerk entirely — see [app.ts:43](artifacts/api-server/src/app.ts#L43).

### Extension internals

`velo-qa/` is a **nested pnpm workspace** (separate `pnpm-workspace.yaml`, NOT covered by the root install — must run `(cd velo-qa && pnpm install)` separately). The extension uses MV3 with:
- `background/` — service worker, recording state machine, message bus to popup
- `content/index.ts` — content script (sanitization, navigation, clicks)
- `content/page-hook.ts` — **runs in `world: 'MAIN'`** to patch `console`/`fetch`/`XHR`; registered as a content script because Chrome serves `.ts` as `video/mp2t` which breaks `<script src>` injection
- `offscreen/` — hosts `MediaRecorder` (service workers can't)
- `preview/` — embedded as web-accessible iframe by content-injected modals

Manifest is built from [manifest.config.ts](velo-qa/extension/src/manifest.config.ts) by `@crxjs/vite-plugin`. `EXT_BUILD_MODE=release` strips localhost from `externally_connectable`, `host_permissions`, and dashboard origins for Chrome Web Store review.

### Backend bundling

The API server is bundled by esbuild ([build.mjs](artifacts/api-server/build.mjs)) into a single ESM file. The big `external:` allowlist is intentional — those packages either use native modules, dynamically `require`, or do path traversal (App Insights, `@azure/*`, pino transports, pg-native, etc.). When adding a dep that misbehaves at runtime in production but works in `dev`, add it to `external`.

`./src/lib/instrumentation` is imported **before** `./app` so App Insights can monkey-patch `http`/`https`/`pg` before any handler imports them. Don't reorder.

## Commands

### Root (pnpm workspace; pnpm only — `preinstall` blocks npm/yarn)

```bash
pnpm install
pnpm dev            # api-server + dashboard in parallel via concurrently
pnpm run typecheck  # libs then artifacts + scripts
pnpm run build      # typecheck + recursive build
```

### Per-artifact

```bash
# Backend (port 4000, tsx watch hot-reload)
pnpm --filter @workspace/api-server dev
pnpm --filter @workspace/api-server build      # esbuild bundle to dist/index.mjs
pnpm --filter @workspace/api-server typecheck

# Dashboard (port 3001, Vite)
pnpm --filter @workspace/snapcap-dashboard dev
pnpm --filter @workspace/snapcap-dashboard build

# DB schema push (uses DATABASE_URL)
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force     # skip safety prompts

# Extension build (nested workspace — `cd velo-qa && pnpm install` first)
cd velo-qa/extension && pnpm run build
cd velo-qa/extension && EXT_BUILD_MODE=release pnpm run build   # CWS-ready
```

### API codegen (Orval)

```bash
cd lib/api-spec && npx orval --config ./orval.config.ts
# Then IMMEDIATELY rewrite lib/api-zod/src/index.ts to:
#   export * from "./generated/api";
```

Or use the package script which also runs the workspace typecheck:
```bash
pnpm --filter @workspace/api-spec run codegen
```

### Environment switching

`./switch-env.sh local|azure` copies `.env.<target>` → `.env` for api-server, dashboard, and extension in one go. After switching, restart services and rebuild the extension. Required for swapping between the local backend and `velocap-api-dev` on Azure.

To pull dev secrets from Key Vault on a fresh clone, follow the block in [LOCAL-DEV.md](LOCAL-DEV.md) ("Pull dev secrets into local `.env` files"). The dev Postgres firewall may need your laptop IP added if you hit `Connection refused`.

## Branch model & deployment

| Branch | Deploys to | Trigger |
|---|---|---|
| `development` | `velocap-*-dev` (ACA + SWA + Postgres) | GitHub Actions on push (paths-filtered) |
| `production` | `velocap-*-prod` | GitHub Actions on push |
| `main` | nothing (mainline) | — |

Workflow: change → `development` → smoke test → fast-forward `production`. Manual runbook lives in [DEPLOY.md](DEPLOY.md), CI in `.github/workflows/`, IaC in `infra/` (Terraform; Azure UAE North, modules + per-env composition, `velocap-kv-{dev,prod}` for all secrets).

## Conventions worth knowing

- **pnpm catalog** (`pnpm-workspace.yaml`): React/Vite/TS/zod/etc. versions are pinned centrally — use `"react": "catalog:"` in package.json, not a literal version.
- **`minimumReleaseAge: 1440`** (24h) blocks freshly-published packages — supply-chain defense. Don't disable; use `minimumReleaseAgeExclude` for urgent trusted-publisher exceptions.
- **Replit-specific `overrides`** strip non-`linux-x64` native binaries from the lockfile. Local macOS dev is kept working by selectively re-enabling `darwin-arm64` entries — don't blanket-remove them.
- **`zod/v4`** is used (`drizzle-zod` integration), not the v3 default.
- **Wouter** for routing (not React Router). Routes mount under `BASE_URL` (`stripBase` strips it for Clerk handoffs).
- **TanStack Query defaults**: `staleTime: 30_000`, `refetchOnWindowFocus: false`. Set deliberately to stop the recording detail page from re-mounting Plyr on focus — don't revert.
- **Clerk cache invalidation**: `ClerkQueryClientCacheInvalidator` in `App.tsx` clears the query cache on userId change (sign-out / account switch). Required because TanStack Query caches across auth boundaries.

## Where things live

| Need to… | Look in |
|---|---|
| Add/change an API endpoint | `lib/api-spec/openapi.yaml` → regenerate → implement in `artifacts/api-server/src/routes/` |
| Add a DB column | `lib/db/src/schema/recordings.ts` → `pnpm --filter @workspace/db run push` |
| Wire a new API call in UI | Use generated hook from `@workspace/api-client-react` (don't hand-roll fetch) |
| Change recording capture | `velo-qa/extension/src/{background,content,offscreen}` |
| Add an env var | api-server reads via `dotenv/config` in `src/index.ts`; dashboard via `import.meta.env.VITE_*`; document in the artifact's `.env.example` |
| Local dev step-by-step | [LOCAL-DEV.md](LOCAL-DEV.md) |
| Deploy / Azure layout | [DEPLOY.md](DEPLOY.md), [infra/README.md](infra/README.md) |
