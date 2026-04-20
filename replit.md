# SnapCap Workspace

## Overview

Full-stack developer tool inspired by Jam.dev. Captures browser screen recordings, network requests, console logs, and user interactions — with a web dashboard for managing, replaying, and sharing sessions.

## Architecture

pnpm workspace monorepo with three main artifacts:
- **Chrome Extension** (`artifacts/chrome-extension/`) — captures sessions in the browser
- **API Server** (`artifacts/api-server/`) — Express + Clerk auth REST API
- **SnapCap Dashboard** (`artifacts/snapcap-dashboard/`) — React + Vite web app at `/`

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 + Clerk Express middleware
- **Auth**: Clerk (web dashboard + API server)
- **Database**: PostgreSQL + Drizzle ORM (tables: recordings, snapcap_users)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- **Frontend**: React + Vite + TanStack Query + Wouter routing
- **UI**: shadcn/ui components + Tailwind CSS
- **Object Storage**: Replit Object Storage (for video uploads)
- **Build**: esbuild (for API server)

## Key Commands

```bash
# Install all dependencies
pnpm install

# Typecheck all packages
pnpm run typecheck:libs

# Push DB schema
pnpm --filter @workspace/db run push

# Run Orval codegen (always fix api-zod/src/index.ts after)
cd lib/api-spec && npx orval --config ./orval.config.ts
# Then immediately write: lib/api-zod/src/index.ts → `export * from "./generated/api";`

# Build API server
pnpm --filter @workspace/api-server run build
```

## Important Notes

### Orval Codegen Fix
After every `orval` run, you MUST write `lib/api-zod/src/index.ts` with just:
```ts
export * from "./generated/api";
```
Orval overwrites this file with a duplicate export that breaks the build.

### API Client Hooks
Generated hooks live in `lib/api-client-react/src/generated/api.ts`. Import from `@workspace/api-client-react`.
Always pass `queryKey` when using `enabled`:
```ts
useGetThing(id, { query: { enabled: !!id, queryKey: getGetThingQueryKey(id) } })
```

### Chrome Extension
- `background.js` — service worker: network interception, message bus, backend sync
- `content.js` — injected in pages: console capture, click tracking, navigation, performance
- `popup.js/html` — recording UI with settings panel (API key + server URL for sync)
- `viewer.html/js` — replays saved recordings (video + network/console log explorer)

### API Routes
- `GET/POST /api/recordings` — list and create recordings
- `GET/PATCH/DELETE /api/recordings/:id` — manage single recording
- `GET /api/recordings/stats` — dashboard statistics
- `POST /api/recordings/:id/share` — create share link
- `DELETE /api/recordings/:id/share` — revoke share link
- `GET /api/share/:token` — public shared recording (no auth)
- `GET /api/me` — user profile + API key preview
- `POST /api/me/api-key` — generate API key for extension sync
- `POST /api/storage/uploads/request-url` — presigned upload URL

### DB Schema
- `recordings` table: id (uuid), userId, title, duration, pageUrl, pageTitle, events (jsonb), tags (text[]), videoObjectPath, shareToken, counts, browserInfo, timestamps
- `snapcap_users` table: id (Clerk userId), apiKey, apiKeyPreview, timestamps

## Artifacts

| Artifact | Path | Description |
|---|---|---|
| `chrome-extension` | (loadable in Chrome) | Browser extension |
| `api-server` | `/api/*` | Express REST API |
| `snapcap-dashboard` | `/` | React dashboard |

## Environment Secrets

- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — Clerk auth
- `DATABASE_URL` — PostgreSQL
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS` — Object storage
- `SESSION_SECRET` — session signing
