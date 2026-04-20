# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Chrome Extension: SnapCap

Located at `artifacts/chrome-extension/`. A Manifest V3 Chrome extension inspired by Jam.dev.

### Features
- Screen recording via `getDisplayMedia` API
- Network request/response capture via `chrome.webRequest`
- Console log interception (log, warn, error, info, debug)
- Unhandled JS error + promise rejection capture
- Full viewer page with video playback + filterable log inspector
- Download video (.webm) and logs (.json)

### Files
- `manifest.json` — Extension manifest (MV3)
- `background.js` — Service worker: network interception, state management
- `content.js` — Page content script: console interception
- `popup.html/css/js` — Extension popup UI
- `viewer.html/css/js` — Full recording viewer page
- `icons/` — Extension icons (16, 32, 48, 128px)
- `HOW_TO_INSTALL.md` — Installation and usage instructions
