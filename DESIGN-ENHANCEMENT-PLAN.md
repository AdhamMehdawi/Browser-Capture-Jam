# VeloCap design enhancement — next phase plan

Picks up after Layer A (palette + fonts + light/dark toggle) and the first wave of design features (stats strip, event minimap, trim bar, tab counts, drag handle, MouseHeatmap, HAR export, delete flow).

What's already implemented vs. what's left from the original `screens.html` brief, plus net-new ideas worth doing.

---

## 1. Status snapshot — what's done, what's pending

### Already shipped
- Warm-dark + warm-paper light palettes, Geist + Instrument Serif + Geist Mono
- Light/dark/system theme toggle in the header
- 7-day stats strip (Captures / Errors / Avg duration / Open share links) with sparklines + deltas
- Event minimap (color-coded ticks, scrub cursor, click-to-seek)
- Visible trim bar (drag handles + bracket markers + waveform pattern)
- Inline tab counts on the recording viewer
- Draggable on-page recording overlay (grip glyph + position persisted)
- MouseHeatmap with thumbnail underlay + timeline scrubber
- HAR export with opt-in response-body capture
- Delete flow with confirmation
- StreamingVideoPlayer hardened (Plyr remount race fixed, Safari WebM fallback)

### Pending from the design brief
- **B1 — Dashboard list polish**: filter chips (Bugs / Reviews / Demos / host pills / removable "last 7 days"), `⇅ Recent` + `⊞ Grid` toggles, bulk-select column, virtualized rows
- **B2 — Recording viewer**: `⌘K Actions` command palette button (currently has no command palette)
- **B3 — Review mode**: comments drawer, assignee, status flow, ticket linkage (whole bigger feature — defer)
- **B4 — Share dialog v2**: expiry / password / embed snippet / view count (needs schema work)
- **B5 — Settings rework**: multiple API keys, appearance picker (we have toggle but no settings page section), notifications config
- **B6 — Public share viewer**: light browser-frame chrome around the dark app
- **B7 — First-run / empty state**: zero-state zigzag + "Try sample" + 30s demo CTA
- **B8 — Marketing home**: huge Instrument Serif hero — out of scope
- **C — Mobile responsive**: 375px breakpoint pass

---

## 2. Plan — 3 phases, deliverables sized to land cleanly

### Phase 1 — finish the dashboard look (~1.5 days)

Goal: the dashboard reads as the design's "01 Dashboard" screen end-to-end.

| Task | Effort | Notes |
|---|---|---|
| **Filter chips row** | 4 h | Replace the current Tabs with chip pills below the stats strip. Categories from tags (Bugs / Reviews / Demos / custom), plus removable filters for host and date. State persisted to URL params. |
| **`⇅ Recent` + `⊞ Grid` toggles** | 1 h | Sort dropdown + view-mode toggle right-aligned in the filter row. The grid view already exists; just wire the toggle. |
| **List row redesign** | 3 h | Adopt the design's row shape: thumbnail-left, title-stack center, tag-chips, mono timestamp + duration + views columns, ⋯ menu. Currently a Card-based grid. |
| **Bulk select column** | 3 h | Checkbox column appears as soon as any row is checked. Bulk-action toolbar (Delete N / Tag / Share) appears in the page header replacing the search bar. |
| **Auto-fade hover affordances** | 30 min | Show delete / share row actions only on hover (already partial — extend to all actions). |

**Acceptance**: side-by-side with `screens.html#dashboard`, the structure matches; tabbing to a chip filters in <200ms; bulk-deleting 10 recordings shows a single confirmation and progresses with a toast.

### Phase 2 — finish the viewer + share (~2 days)

Goal: the recording viewer + share flow reach feature parity with the design.

| Task | Effort | Notes |
|---|---|---|
| **`⌘K Actions` command palette** | 5 h | Cmdk-style palette over the viewer. Actions: Copy link, Share, Download HAR, Delete, Trim full, Reset trim, Jump to error, Open in Plyr fullscreen. Keyboard shortcut `⌘K` / `Ctrl K`. |
| **Stack frames under errors** | 1 h | Console errors render their stack lines indented underneath with `at <fn> (<file:line>)`. Today's UI shows just the top message. |
| **Share v2 — expiry & password** | 4 h | Backend: add `expiresAt` + `passwordHash` columns to recordings, validate in `/share/:token` route, return 410 if expired. Frontend: tabbed share dialog (Link / Embed / Expiry & password). |
| **Share v2 — embed snippet** | 1 h | Copyable `<iframe>` snippet. Easy because the share page already works in an iframe. |
| **Share v2 — view count** | 2 h | New `shared_views` table or a column on recordings. Increment on each shared-page mount (debounced to once per IP per hour). Surface the count in the share dialog. |
| **Public viewer chrome** | 1 h | Wrap `/share/:token` in a light browser-frame card (matches the design's screenshots). Light mode by default for the public page; signed-in dashboard stays user-pref. |

**Acceptance**: `⌘K` brings up a palette; share with 7-day expiry + password works end-to-end (test in incognito); embed snippet renders properly in a third-party page; opening the share link increments the view count.

### Phase 3 — onboarding + mobile (~1 day)

Goal: first-run experience matches design; the app works on phones.

| Task | Effort | Notes |
|---|---|---|
| **Empty / first-run zigzag** | 3 h | Three-step onboarding shown when `recordings.length === 0`: Install extension → Record bug → Share replay. Each with a thumbnail mock. Bottom row: "Try sample recording" (loads a fixture) + "Watch 30s demo" (linked video). |
| **Settings → multiple API keys** | 3 h | New schema: `api_keys` table (id, user_id, name, key_prefix, last_used_at, created_at, revoked_at). List/create/revoke UI in Settings. Replaces the single `apiKey` column on users (migrate existing keys on first read). |
| **Settings → notifications** | 2 h | Slack webhook URL field + email recipients list per workspace. Wire to a single hook in the upload-complete path that fires a notification. |
| **Mobile responsive pass** | 3 h | Sidebar → bottom tab bar at <768px. Stats cards stack 2×2 then 1×4. Viewer stacks vertically — video on top, tabs below. Trim bar handles get bigger (44 px hit targets). |

**Acceptance**: empty account shows the zigzag; create + revoke API keys works; an upload triggers a Slack ping; loading the dashboard on an iPhone 13 Mini shows a usable layout.

---

## 3. Net-new ideas worth doing (beyond `screens.html`)

These weren't in the original design brief but would meaningfully sharpen the product. Listed roughly by ROI.

### A. AI bug summary on the recording detail
- On a successful upload, fire a server-side job that sends `console errors + failed network calls + first 3 console.warn + page URL` to Claude (or local heuristic). Generate: **headline, suspected root cause, 3 step-to-reproduce bullets**. Surface on the Info tab.
- Cost: ~1 cent per recording, ~1 day to build (Anthropic API key in Key Vault; existing api-server can call out).
- Big visible value — turns a recording into a near-finished bug report.

### B. Auto-fill the share dialog with a "good" preview thumbnail
- When the user opens Share, generate a 3-frame filmstrip of the recording (10s / 50% / -2s of duration). Show in the dialog. Pick the one with the most interaction signal (max click density). Embed that frame in the share OG/Twitter card so links in Slack get a rich preview.
- ~half a day, mostly ffmpeg scripting in the existing transcode lane.

### C. Linkable error groups
- Group identical console errors across recordings (normalize stack trace → fingerprint). Add a `/errors` page with a top-list and click-through to recordings that contain that error. This is the "Sentry inside VeloCap" play.
- ~2 days. Real, ongoing value for teams.

### D. Smart trim suggestions
- After upload, compute: time of first user interaction, time of last error, time of last user action. Auto-suggest a trim window that just covers those events. Show as a chip on the trim bar: "Suggested: 0:12 → 0:48 — accept?".
- ~half a day. The data is already there; just a heuristic + UI.

### E. Recording → Playwright / Cypress test export
- Already half-built (`generateCypressSpec` exists in `recording.tsx`). Polish: copy-to-clipboard, format as a complete `.spec.ts` file, support Playwright too. One-click "Export as test" button.
- ~1 day. Differentiator — Loom / Jam don't do this well.

### F. Dashboard "Today" hero card
- At the top of `/dashboard` when there's recent activity: a big editorial card ("3 captures today · 2 with errors · longest 4:12") in Instrument Serif italic. Replaces the generic "Captures" title for engaged users. Disappears on empty days.
- ~3 hours. Pure design polish but it gives the dashboard a voice.

### G. Searchable command palette across recordings
- `⌘K` from anywhere → search across all recordings by title / URL / console messages. Jump-to-recording with arrow keys.
- ~half a day if added alongside the viewer's palette (same component, different action set).

---

## 4. Suggested execution order

If we go feature-first (recommended):

1. **Phase 1 (dashboard polish)** — biggest visual delta with the smallest scope
2. **#F Today hero card** — quick polish win
3. **Phase 2 part 1 (`⌘K` palette + stack frames)** — `⌘K` reused by #G
4. **#A AI bug summary** — high-impact feature with clear value
5. **Phase 2 part 2 (Share v2)** — needs backend schema work, do once together
6. **Phase 3 (onboarding + mobile + settings)** — wraps up the design brief
7. **#C error groups + #E test export** — pick whichever sells the product better for you

Rough total: **~6 dev days** for everything above. Phases 1+2 alone (~3.5 days) deliver the full design vision.

---

## 5. Decisions I need from you before starting Phase 1

1. **Tags model**: do we want a tags table + per-recording many-to-many, or just keep the existing `tags: text[]` column? The column is fine for filter chips; a table only matters if you want tag management UI (rename, delete, color-code).
2. **Filter persistence**: URL params (shareable) or localStorage (per-user)? Recommend URL params for power users.
3. **Bulk delete confirmation**: one "Delete N recordings?" dialog OR per-row dialog (slower)? Recommend one bulk dialog.
4. **Grid view default**: list or grid? Design shows list-first with a chip-toggle. Recommend list.

Reply with answers (or "your call on all") and I'll start Phase 1 with the filter chips row.
