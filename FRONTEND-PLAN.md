# VeloCap Dashboard — Frontend Features & Plan

> Scope: [artifacts/snapcap-dashboard/](artifacts/snapcap-dashboard/) — the React + Vite web app that pairs with the Chrome extension.
> Sibling apps (Chrome extension, API server, infra) are referenced only where they affect the frontend.

---

## 1. Tech stack snapshot

| Concern | Choice |
|---|---|
| Framework | React 18 + Vite + TypeScript |
| Routing | `wouter` (with `base` from `BASE_URL`) |
| Auth | Clerk (`@clerk/react`) — JWT bridged into API client via `setAuthTokenGetter` |
| Data | TanStack Query + Orval-generated hooks from [lib/api-client-react/](lib/api-client-react/) |
| UI kit | shadcn/ui on Radix primitives + Tailwind CSS |
| Charts | Recharts |
| Forms | react-hook-form + Zod resolvers |
| Video | Plyr (`plyr-react`) via [StreamingVideoPlayer](artifacts/snapcap-dashboard/src/components/StreamingVideoPlayer.tsx) |
| Toasts | `sonner` + radix Toaster |
| Misc | `framer-motion`, `lucide-react`, `date-fns`, `recharts`, `cmdk`, `vaul`, `next-themes` |
| Replit dev | `@replit/vite-plugin-*` (cartographer, dev-banner, runtime-error-modal) |

Entry: [src/App.tsx](artifacts/snapcap-dashboard/src/App.tsx) wires `WouterRouter → ClerkProvider → QueryClientProvider → TooltipProvider → Router → Toaster`.

---

## 2. Routes & pages (current)

Defined in [App.tsx:153-176](artifacts/snapcap-dashboard/src/App.tsx#L153-L176).

| Path | Auth | Component | File |
|---|---|---|---|
| `/` | Public (redirects signed-in → `/dashboard`) | `HomeRedirect` → `Home` | [pages/home.tsx](artifacts/snapcap-dashboard/src/pages/home.tsx) |
| `/sign-in/*` | Public | Clerk `<SignIn />` | [App.tsx:77](artifacts/snapcap-dashboard/src/App.tsx#L77) |
| `/sign-up/*` | Public | Clerk `<SignUp />` | [App.tsx:85](artifacts/snapcap-dashboard/src/App.tsx#L85) |
| `/dashboard` | Protected | `Dashboard` | [pages/dashboard.tsx](artifacts/snapcap-dashboard/src/pages/dashboard.tsx) |
| `/recordings/:id` | Protected | `RecordingViewer` | [pages/recording.tsx](artifacts/snapcap-dashboard/src/pages/recording.tsx) |
| `/settings` | Protected | `Settings` | [pages/settings.tsx](artifacts/snapcap-dashboard/src/pages/settings.tsx) |
| `/share/:token` | Public | `SharedRecordingViewer` | [pages/shared.tsx](artifacts/snapcap-dashboard/src/pages/shared.tsx) |
| `/extension-auth` | Public (uses Clerk if signed in) | `ExtensionAuth` | [pages/extension-auth.tsx](artifacts/snapcap-dashboard/src/pages/extension-auth.tsx) |
| `/privacy` | Public | `Privacy` | [pages/privacy.tsx](artifacts/snapcap-dashboard/src/pages/privacy.tsx) |
| `*` | Public | `NotFound` | [pages/not-found.tsx](artifacts/snapcap-dashboard/src/pages/not-found.tsx) |

---

## 3. Feature inventory (what exists today)

### 3.1 Auth & session
- Clerk-hosted sign-in / sign-up with custom theming (purple primary, Inter font) — [App.tsx:30-75](artifacts/snapcap-dashboard/src/App.tsx#L30-L75).
- `ClerkApiTokenBridge` pipes Clerk JWT into every Orval `customFetch` call so the cross-origin API gets `Authorization: Bearer …` headers — [App.tsx:125-132](artifacts/snapcap-dashboard/src/App.tsx#L125-L132).
- `ClerkQueryClientCacheInvalidator` clears TanStack Query cache whenever the active user changes (prevents previous user's data leaking after a sign-out/in cycle) — [App.tsx:134-151](artifacts/snapcap-dashboard/src/App.tsx#L134-L151).
- `ProtectedRoute` gate using Clerk `<Show when="signed-in/out">` + redirect-to-home for guests — [App.tsx:106-119](artifacts/snapcap-dashboard/src/App.tsx#L106-L119).

### 3.2 Marketing / landing
- Hero with gradient headline, two CTAs (Start Recording / View Demo).
- Feature triple grid: High-Fidelity Replay, Network Deep Dive, Console & Interactions.
- Footer with Privacy / Terms / GitHub (Terms and GitHub are placeholder `#`).
- Sticky blurred header with brand and Sign In / Get Started buttons.

### 3.3 App shell ([components/layout.tsx](artifacts/snapcap-dashboard/src/components/layout.tsx))
- Top bar: sidebar toggle, VeloCap logo, "Get Chrome Extension" CTA linking to the live CWS listing, user dropdown (avatar, full name, Settings, Sign out).
- Collapsible sidebar (w-16 ↔ w-52) with Dashboard / Settings entries; tooltips when collapsed.
- Bottom-of-sidebar mini profile card.

### 3.4 Dashboard ([pages/dashboard.tsx](artifacts/snapcap-dashboard/src/pages/dashboard.tsx))
- **Stats row** (4 cards): total recordings, total requests, total errors, avg error rate — via `useGetRecordingStats`.
- **Tag filter pills**: All / Bug / Feature (currently hardcoded — tags are mock).
- **Recordings list**:
  - Search by title (`search` param to `useListRecordings`).
  - Grid / list view toggle (icon switcher).
  - Each card renders a hover-to-play video preview backed by Azure SAS URLs (with thumbnail image fallback and "Preview unavailable" graceful failure path).
  - Image-only recordings render an `<img>`; logs-only recordings render an Activity placeholder.
  - Per-card delete button (hover-revealed, with optimistic invalidation of `recordings` + `stats` queries). Note: implemented as a raw `fetch` instead of `useDeleteRecording` — see §6.
  - Empty state when no recordings exist.
- **Right rail**:
  - "Requests Over Time" — Recharts AreaChart bound to `stats.requestsByDay`.
  - "Top Error Pages" — ranked list with destructive badges, hostname-stripped URL display.

### 3.5 Recording viewer ([pages/recording.tsx](artifacts/snapcap-dashboard/src/pages/recording.tsx)) — the heaviest page (~1100 lines)
- **Header**: back to dashboard, title, captured timestamp, page-hostname link, Share button.
- **Resizable two-pane layout** (`ResizablePanelGroup`): video left (default 65%), tabs right (default 35%, 20-60% range).
- **Video player**: shared [StreamingVideoPlayer](artifacts/snapcap-dashboard/src/components/StreamingVideoPlayer.tsx) — Plyr instance pointed at the Azure SAS URL, with native HTTP Range streaming. Falls back to image rendering for screenshot-type captures.
- **Trim controls**: state for `trimStartMs`/`trimEndMs`/`trimActive`; debounced PATCH to `/api/recordings/:id` with 800ms debounce; "Reset" clears trim server-side.
- **Tabs** (Info / Console / Network / Actions):
  - **Info**: URL, custom tags, timestamp, timezone, OS, browser UA tail, viewport, screen + DPR, stats grid (requests / errors / console / clicks).
  - **Console**: timeline list with color-coded level (error/warn/info), per-row click opens detail drawer.
  - **Network**: dense fixed-column table — #, Method (color-coded), Status (badged by 2xx/3xx/4xx+), URL path+search, Domain, Duration. Sticky header. Click → drawer.
  - **Actions**: chronologically merged click / input / select / submit / navigation events with icons.
  - Filter input at the top of all log tabs; debounce-free, case-insensitive across `url`, `message`, `status`.
- **Min-skeleton timer** (400 ms) prevents skeleton flicker on fast responses — [recording.tsx:266-273](artifacts/snapcap-dashboard/src/pages/recording.tsx#L266-L273).
- **Detail drawer** (slide-in from right, Escape/backdrop close):
  - Network: status + duration, full request/response headers (mono, copyable), `PayloadBlock`-rendered request/response bodies with JSON syntax highlighting, kind detection (JSON / form / text), and byte-size badge.
  - Console: message + stack trace block when present.
  - Action events: primary selector + alternate selectors (each individually copyable), action metadata grid (tag, role, text, input type, name, URL at time), value preview, and a **per-event Cypress snippet** generated via `generateCypressSpec` ([recording.tsx:131-198](artifacts/snapcap-dashboard/src/pages/recording.tsx#L131-L198)) — uses `cy.contains` for button/link text when available, `[masked]` → `Cypress.env(...)`, navigation collapsing, etc.
- **Share modal**: copies a public `/share/:token` link; lazily creates one via `useCreateShareLink` if absent.

### 3.6 Shared recording viewer ([pages/shared.tsx](artifacts/snapcap-dashboard/src/pages/shared.tsx))
Mirrors the recording viewer feature-for-feature but:
- Hydrates from `useGetSharedRecording(token)` — no Clerk session needed.
- No share/delete/trim actions (read-only).
- Same Plyr player, same tabs, same payload/highlight renderer.

### 3.7 Settings ([pages/settings.tsx](artifacts/snapcap-dashboard/src/pages/settings.tsx))
- **Profile**: avatar (Clerk image URL), full name, email, total recordings badge.
- **Extension Integration**: shows masked API key preview; "Generate / Regenerate" button (with `confirm` warning that old key is invalidated); on success shows the one-time full key with copy-to-clipboard and "you will not be able to see it again" alert; embedded instructions for pasting into the extension popup.
- **Data & Privacy**:
  - Export → `GET /api/me/export`, downloads JSON blob with `Authorization: Bearer …`.
  - Delete Account → double `confirm` + `DELETE /api/me`, then `signOut()`.
- **Session**: Sign-Out button.

### 3.8 Extension auth callback ([pages/extension-auth.tsx](artifacts/snapcap-dashboard/src/pages/extension-auth.tsx))
- Reads `?extensionId=` from query string.
- If signed in: `getToken()` → `chrome.runtime.sendMessage(extensionId, { kind: "clerk-auth-callback", token })` with 1-second ack timeout.
- If signed out: renders Clerk `<SignIn />` inline.
- Status state machine: `loading | sending | success | error`.

### 3.9 Privacy page
Static legal page — what we capture, redaction rules, retention, GDPR rights, third parties (Clerk, Azure, App Insights).

### 3.10 Cross-cutting infrastructure
- **Theme**: light theme is the active baseline; `next-themes` and a CSS-vars colour system (`hsl(var(--primary))`, etc.) are wired but not exposed as a user toggle.
- **Toasts**: `sonner` for status, shadcn `<Toaster />` for legacy callers.
- **Skeletons** used throughout for loading shimmer (`<Skeleton />`).
- **`useGetMe`**, **`useGenerateApiKey`**, **`useListRecordings`**, **`useGetRecordingStats`**, **`useGetRecording`**, **`useDeleteRecording`**, **`useCreateShareLink`**, **`useGetSharedRecording`** — Orval-generated TanStack Query hooks.

### 3.11 Available but unused UI primitives
[src/components/ui/](artifacts/snapcap-dashboard/src/components/ui/) ships a complete shadcn library (accordion, alert-dialog, calendar, carousel, chart, command palette via `cmdk`, drawer, form, hover-card, menubar, navigation-menu, pagination, popover, progress, radio-group, sheet, sidebar, slider, spinner, switch, table, etc.). Most are unused — fair game for the upcoming features below.

---

## 4. Gaps & rough edges (worth fixing before adding scope)

| # | Issue | Where |
|---|---|---|
| 1 | Tag filter pills are hardcoded `bug` / `feature` — there is no real tag-mgmt UI and no source for the list. | [dashboard.tsx:77-88](artifacts/snapcap-dashboard/src/pages/dashboard.tsx#L77-L88) |
| 2 | Delete uses a raw `fetch` instead of `useDeleteRecording` (mutation hook is imported but unused). | [dashboard.tsx:31-60](artifacts/snapcap-dashboard/src/pages/dashboard.tsx#L31-L60) |
| 3 | `console.log` calls left in the delete handler. | [dashboard.tsx:35,45,53,57](artifacts/snapcap-dashboard/src/pages/dashboard.tsx#L35) |
| 4 | Footer Terms / GitHub links are `#` placeholders. | [home.tsx:103-104](artifacts/snapcap-dashboard/src/pages/home.tsx#L103-L104) |
| 5 | "View Demo" CTA points at `/sign-in` — there is no actual demo. | [home.tsx:50](artifacts/snapcap-dashboard/src/pages/home.tsx#L50) |
| 6 | Settings uses `window.confirm` for destructive flows; should use `<AlertDialog />`. | [settings.tsx:24,195-196](artifacts/snapcap-dashboard/src/pages/settings.tsx#L24) |
| 7 | Delete-account "type DELETE to confirm" is non-functional — second `confirm` just asks again. | [settings.tsx:196](artifacts/snapcap-dashboard/src/pages/settings.tsx#L196) |
| 8 | `recording.tsx` and `shared.tsx` duplicate `CopyButton`, `detectPayload`, `highlightJson`, `PayloadBlock` — ~80% identical code, ~1900 lines combined. | both files |
| 9 | `recording.tsx` mixes Orval hooks with raw `fetch` for trim PATCH. | [recording.tsx:438-455](artifacts/snapcap-dashboard/src/pages/recording.tsx#L438-L455) |
| 10 | Hover-to-play video previews on grid cards run a `<video>` per card with `preload="none"` only when a thumbnail exists — for many recordings this still triggers concurrent metadata fetches. | [dashboard.tsx:202-249](artifacts/snapcap-dashboard/src/pages/dashboard.tsx#L202-L249) |
| 11 | Network/Console tables have a hard `w-[700px]` and `min-w-[700px]`, breaking responsive shrinking in the resizable pane. | [recording.tsx:685,752](artifacts/snapcap-dashboard/src/pages/recording.tsx#L685) |
| 12 | No global error boundary; an Orval 401/network error throws and surfaces as a blank page. | global |
| 13 | No keyboard shortcuts (Cypress / Jam users expect `J`/`K` event navigation, `/` to focus filter, `Esc` to close drawer — only Esc works today). | [recording.tsx:246-251](artifacts/snapcap-dashboard/src/pages/recording.tsx#L246-L251) |
| 14 | Theme toggle is shipped (`next-themes`) but never surfaced; light mode is the only mode you can reach. | global |
| 15 | Sidebar only has two entries — once the feature list below lands, it needs sections (Captures / Tools / Account). | [layout.tsx:26-29](artifacts/snapcap-dashboard/src/components/layout.tsx#L26-L29) |

---

## 5. Build plan — proposed feature roadmap

Sequenced so each phase is shippable on its own.

### Phase 0 — Hygiene (1–2 days)
0.1 Replace raw delete `fetch` with `useDeleteRecording`; remove `console.log`s.
0.2 Extract `CopyButton`, `PayloadBlock`, `detectPayload`, `highlightJson` into `src/components/log-viewer/` and share between recording + shared pages.
0.3 Add a global `<ErrorBoundary />` at the layout level + a `<NotAuthorized />` panel for 401s.
0.4 Move trim PATCH to a typed Orval mutation (extend OpenAPI spec).
0.5 Replace `window.confirm` flows with `<AlertDialog />`; wire the "type DELETE" confirmation through a controlled `<Input />`.
0.6 Fix `home.tsx` placeholder links; ship `/terms` page and point GitHub link to repo.
0.7 Lift Network/Console table widths so they respect the resizable pane.

### Phase 1 — Recording management UX (3–5 days)
1.1 **Real tag system** — `useListTags()` to populate filter pills, `useUpdateRecording` for tag editing, multi-select with `cmdk` command palette.
1.2 **Bulk select** on dashboard — checkbox column / cards, bulk delete, bulk tag, bulk export.
1.3 **Inline rename** of recording title (click-to-edit, optimistic update).
1.4 **Sort & filter dropdown** — newest/oldest, duration, error count, has-errors-only, has-shared-only.
1.5 **Pagination or infinite scroll** for the recordings list (currently capped at `limit: 50`).
1.6 **Empty-state CTA** linking to extension install + a step-by-step onboarding card for first-time users with zero recordings.

### Phase 2 — Recording viewer power-ups (1 week)
2.1 **Timeline scrubber synced to events** — clicking a console/network/action row seeks the video to that timestamp; the video's `currentTime` highlights the active event in the list.
2.2 **Event minimap** under the video — coloured ticks for errors / 4xx-5xx / actions, hover preview.
2.3 **Trim UI** — ship a proper `<Slider />` two-handle range over the timeline (state plumbing already exists; just needs visual surface).
2.4 **Keyboard shortcuts** — `J/K` next/prev event, `Space` play/pause, `/` focus filter, `[ ]` set trim handles, `?` cheat sheet (`<Dialog />`).
2.5 **Comments / annotations** — `<Drawer />` for threaded notes anchored to a timestamp; backend additions needed.
2.6 **Filmstrip thumbnails** — periodic frames extracted on the API side, rendered as a scrub preview.
2.7 **Network waterfall view** — alternate to the table; `<Recharts>` Gantt-style stack of request timings.
2.8 **HAR export** — single button to download a HAR-compatible JSON of the network events.

### Phase 3 — Sharing & collaboration (3–5 days)
3.1 **Share dialog upgrades** — expiry picker, password protect (server-side), "viewable by people in my org" once teams exist.
3.2 **Embed code** — copyable `<iframe>` snippet for the shared viewer.
3.3 **Share-link analytics** — view count + last-viewed timestamp on `/recordings/:id`.
3.4 **Revoke share** — already in the API spec (`DELETE /share/:token` route on the backend) — needs a UI surface in the share modal.

### Phase 4 — Cypress & test scaffolding (1 week)
4.1 **Full-spec Cypress export** for the whole recording (currently per-event only) — file download with `.cy.ts` extension.
4.2 **Playwright export** — same scaffold against `@playwright/test` syntax.
4.3 **Curl export** for selected network request (already trivial, just a button in the drawer).
4.4 **Repro link** — a `cypress run` command that pulls the spec via API key.

### Phase 5 — Account & settings (3–5 days)
5.1 **Multiple API keys** with labels, last-used timestamps, individual revoke (today there's only the one rotatable key).
5.2 **Notification prefs** — email me on share view, on extension upload, weekly digest.
5.3 **Workspace / org switcher** — Clerk Organizations integration; share recordings within an org.
5.4 **Theme switcher** — finally surface `next-themes`; user, system, light, dark.
5.5 **Language / locale** — i18n scaffolding with `react-intl` or `i18next` for the dashboard chrome.

### Phase 6 — Analytics & insights (1 week)
6.1 **Recordings index** with calendar heatmap (`react-day-picker`) of capture frequency.
6.2 **Per-domain breakdown** — top sites recorded, error rate by site.
6.3 **Performance dashboard** — pull the `performance` events into Web Vitals (LCP, INP, CLS) charts.
6.4 **Trend deltas** — week-over-week comparisons on the existing stats cards.

### Phase 7 — Onboarding & growth (3–4 days)
7.1 **First-run tour** — Driver.js-style popovers walking through the recording viewer.
7.2 **Demo recording** — bundle a canned recording so signed-out users can hit "View Demo" on `/` and land in `/share/<demo-token>`.
7.3 **Install-checker** — detect whether the Chrome extension is installed (try `chrome.runtime.sendMessage` to the published ID); badge sidebar when not.
7.4 **Inline release notes** — `<Drawer />` opened from the sidebar with the latest changelog (markdown-rendered).

### Phase 8 — Quality & resilience (continuous)
8.1 **E2E suite** — Playwright against a seeded dev backend; cover sign-in, list, view, share, delete.
8.2 **Component tests** — Vitest + Testing Library for the heavy viewer pieces (`PayloadBlock`, `generateCypressSpec`, log filtering).
8.3 **Error tracking** — Sentry or App Insights browser SDK + source maps.
8.4 **Performance budget** — `vite-bundle-visualizer` step in CI; code-split the recording viewer (it currently ships in the main bundle at ~1100 LOC).
8.5 **Accessibility pass** — focus rings on every clickable card, semantic landmarks, aria-live on toast region, contrast audit on dark theme.

---

## 6. Suggested directory shape after Phase 0–2

```
src/
  pages/
    home.tsx
    dashboard.tsx
    recording.tsx                ← stays, but slimmer
    shared.tsx                   ← stays, but slimmer
    settings.tsx
    extension-auth.tsx
    privacy.tsx
    not-found.tsx
  components/
    layout.tsx
    error-boundary.tsx           (new)
    log-viewer/                  (extracted shared pieces)
      copy-button.tsx
      payload-block.tsx
      detect-payload.ts
      highlight-json.ts
      event-row.tsx
      network-table.tsx
      detail-drawer.tsx
    video/
      streaming-video-player.tsx
      trim-range.tsx             (new)
      filmstrip.tsx              (new, Phase 2)
    dashboard/
      stats-row.tsx
      recording-card.tsx
      recording-list.tsx
      bulk-action-bar.tsx        (new, Phase 1)
    onboarding/                  (Phase 7)
      install-checker.tsx
      tour.tsx
  hooks/
    use-keyboard-shortcuts.ts    (new, Phase 2)
    use-debounced-mutation.ts    (factored out of recording.tsx)
  lib/
    cypress-exporter.ts          (moved from recording.tsx)
    playwright-exporter.ts       (new)
    har-exporter.ts              (new)
```

---

## 7. Open product questions

1. **Multi-tenant** — do we need Clerk Organizations now or after Phase 4? Phase 3.1 (org-scoped sharing) and Phase 5.3 depend on the answer.
2. **Demo data** — is there an existing recording we can publish as the "View Demo" target? If not, Phase 7.2 needs a fixture.
3. **Payments** — no billing UI exists today. If usage limits are coming, Settings needs a `/settings/billing` route (Stripe Customer Portal embed is the simplest).
4. **Annotations storage** (Phase 2.5) — comments require a backend schema change; align with API team before frontend work starts.
5. **Tag taxonomy** — are tags free-form (Phase 1.1) or workspace-managed? Affects whether the picker is `cmdk` typeahead or a fixed list.

---

## 8. Definition of done per feature

For every item above, "done" means:
- [ ] Typecheck passes (`pnpm run typecheck`).
- [ ] No `console.*` in production code paths.
- [ ] Loading + empty + error states all rendered (no blank screens on slow API).
- [ ] Mobile-OK at 375 px width (collapse to single column where reasonable).
- [ ] All destructive actions use `<AlertDialog />`, not `window.confirm`.
- [ ] Orval hook used (no ad-hoc `fetch` unless the endpoint isn't in the OpenAPI spec yet).
- [ ] Telemetry event fires (Phase 8.3 onwards) for the primary action.
- [ ] Story in `pages/` or `components/` is small enough to read top-to-bottom — anything over ~400 lines gets broken up.
