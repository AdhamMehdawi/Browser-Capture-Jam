# VeloCap design implementation — plan

Bundle: `velocapp/` from claude.ai/design handoff. Two design files referenced:

- **`wireframes.html`** — sketchy / paper / hand-drawn vibe (Kalam + Caveat fonts, paper background). Exploratory.
- **`screens.html`** — polished, committed direction. **Warm-dark editorial.** Instrument Serif italics, Geist body, Geist Mono labels. Coral accent on near-black canvas. *This is what the user wants implemented.*

The wireframes are exploration; the screens file is the destination. Wireframes inform *what features* exist; screens inform *how they look*.

---

## Design system to adopt (from `screens.html`)

### Palette — both modes

**Dark app surface** (the "warm-dark editorial" the user picked):
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0e0f12` | page background |
| `--bg-2` | `#14161b` | sidebar |
| `--surf` | `#181b21` | cards, inputs |
| `--surf-2` | `#1f232a` | active states |
| `--surf-3` | `#262a32` | hover |
| `--line` | `#2a2e37` | dividers |
| `--text` | `#ecebe5` | primary text |
| `--text-2` | `#b6b3a8` | secondary |
| `--text-3` | `#7c7a72` | tertiary / labels |
| `--accent` | `#e8835a` | warm coral — primary action, links, highlights |
| `--accent-soft` | `rgba(232,131,90,.16)` | accent fill on translucent surfaces |
| `--brand` | `#7a9bff` | informational tags, sparklines |
| `--ok` | `#6ec38e` | success |
| `--warn` | `#e8b85a` | warnings |
| `--err` | `#ef6f6f` | errors |

**Light page chrome** (for marketing / public pages we choose to make light):
- `--page: #f1ede4`, ink `#1a1a1a`, accent `#c64a3a` (slightly deeper coral on light).

### Typography
| Family | Weight | Use |
|---|---|---|
| **Instrument Serif** (italic) | 400 | page titles (`Captures`, `Recording`), section names, brand mark. Italic by default. |
| **Geist** | 400 / 500 / 600 / 700 | body, buttons, labels |
| **Geist Mono** | 400 / 500 / 600 | timestamps, IDs, breadcrumb labels, keyboard shortcut chips, table columns |

Font sizes/sample hierarchy:
- Marketing hero title: 92px Instrument Serif
- Page title (Captures, Recording): 32–54px Instrument Serif italic
- Section labels: 11–13px Geist Mono, uppercase, .14em letter-spacing
- Body / table cells: 13–14px Geist
- Mono timestamps: 11–12px Geist Mono

### Shape language
- Borders 1px solid `--line`, rounded **8px** (inputs, chips, buttons) and **12–14px** (cards, browser frame).
- Browser frame chrome: red/yellow/green dots, dark URL pill, slight shadow.
- Pills/chips: 999px radius. "On" state = inverted ink/coral fill.
- Sparkline polylines (80×36 viewBox, stroke 1.5) inside stat cards.
- "Minimap" timeline: thin ticks (2–3px wide × ~28px tall) colored by event type, positioned absolutely on a 100%-wide strip.

### Iconography
The screens file uses **Unicode glyphs** (`▦ ↗ ★ ⚙ ⌕ ↗ ↓ ↩ ▶ ⋯`) as placeholders. For production:
- Keep glyphs where they match (mono-feel sidebar nav)
- Replace with **Lucide icons** (already used by the dashboard) where the glyph looks weak (`▦` → `Activity`, `↗` → `Share2`, etc.)

---

## What to implement, where

The current dashboard (`artifacts/snapcap-dashboard/src/`) already has shadcn/ui + Tailwind v4 + Wouter. We're **restyling**, not rebuilding routes. Three layers of change:

### Layer A — tokens (one-time, foundational)

**Where:** `artifacts/snapcap-dashboard/src/index.css` and / or shadcn theme variables.

- Swap CSS custom properties to the warm-dark palette above. Match shadcn token names: `--background → --bg`, `--card → --surf`, `--muted → --surf-2`, `--primary → --accent`, `--destructive → --err`, etc.
- Add Instrument Serif + Geist + Geist Mono via `<link>` in `index.html` or local font files. Set defaults in `body` and override per-component as needed.
- Light mode for marketing / share pages: same tokens, light values. Define a `.light` class wrapper.

Acceptance: refresh the dashboard → it already feels like the design with zero per-component edits.

### Layer B — per-screen polish (the visible upgrades)

#### B1. Dashboard list (`/pages/dashboard.tsx`)
- **Header**: breadcrumb mono uppercase (`workspace · acme / captures`) + Instrument Serif italic "Captures" title + search pill with `⌘K` chip + Import + **coral primary "New capture" button**.
- **Stats strip** (4 cards): "Captures · 7d", "Watched · 7d", "Avg duration", "Open share links". Each card: mono label, big number, delta line, sparkline SVG (data: we already have `/api/recordings/stats`). Adopt the card layout verbatim.
- **Filter chips** (replaces existing tabs): "All", "Bugs", "Reviews", "Demos", host pills, "team:", "last 7 days × (removable)". `⇅ Recent` and `⊞ Grid` toggles right-aligned. Active chip = coral text + coral underline + soft fill.
- **List rows**: thumb (left, 16:9 frame placeholder), title + sub (URL · browser), tag chips, mono timestamp, mono duration, mono views, `⋯` actions. Selected row gets `bg-surf-2` + left coral border. **Bulk-select**: checkbox column hidden until first row checked.

#### B2. Recording viewer (`/pages/recording.tsx`) — **biggest win**
The design splits this differently from our current layout:

| Region | Design | Current | Change |
|---|---|---|---|
| Title block | Back arrow + Instrument Serif title + mono meta line (date · host · duration · browser) + inline tag chips | Same idea but generic styling | Restyle in the new palette |
| Header actions | `⌘K Actions`, `↓ HAR`, **coral `↗ Share`** | Copy link + Share | Match design (3 buttons). Group with consistent button styling. |
| **Minimap row** (new) | Below video. Full-width strip with color-coded ticks per event: coral=clicks, blue=info, amber=warn, red=error. Scrub cursor on the strip. Label "click · console · network · cursor" at the bottom. | We have nothing like this | **Build this.** Data is already in the events array. |
| **Trim bar** (new) | `[ 00:32 ────waveform──── 01:08 ] trim` — mono brackets, simulated waveform inside, trim button. | We have trim state but the UI is hidden in Plyr handles | Surface as a row beneath the video. Keeps the existing handle interaction but with visible bookmarks. |
| Right pane tabs | `Console (3) · Network (18) · DOM · Info` — counter chips inline. Active tab gets coral underline. | We have tabs but no inline counters | Add counts; restyle. |
| Console rows | Mono timestamp · level pill · message with bolded entity names. Stack frames indented under errors. Errors tint the row coral-red. | Generic monospace | Re-template the row component. |

#### B3. Review mode (`screens.html` "03 Review mode")
This is a **new flow**: same viewer with a bottom drawer for comments + assignee + ticket linkage. Out of immediate scope unless we want to ship the Jira / Comments features I proposed earlier — flag as a Phase-2 implementation that ties into the proposed feature list.

#### B4. Share dialog v2 (`/pages/recording.tsx` — `<Dialog>`)
- Tabbed dialog: **Link · Embed · Expiry & password**.
- Link tab: read-only mono input + Copy button (already have).
- Embed tab: a copy-able iframe snippet.
- Expiry tab: expiry-date picker, optional password input, "viewable by signed-in only" toggle.
- All controlled by the existing `createShareLink` mutation, extended server-side with `expiresAt` and `passwordHash` columns (separate work — feature #10 from the list I gave earlier).

#### B5. Settings (`/pages/settings.tsx`)
- Long page with section tabs across the top: **Account · API keys · Appearance · Notifications**.
- **API keys**: list of keys with `created`, `last used`, `revoke` action. Per design: monospace tokens with eye-toggle + copy. We currently only have one key field; needs schema change to support multiple.
- **Appearance**: light / dark / system. Toggle wired to our new `.light` wrapper.
- **Notifications**: Slack channel + email recipients per workspace. (Ties to proposed feature #4.)

#### B6. Public share viewer (`/pages/shared.tsx`)
- Same viewer layout as B2 but stripped of edit controls. "Read-only" badge top-right (already exists; restyle).
- Light-mode page chrome surrounding the dark app — exactly as `screens.html` shows in browser-frame.
- Branded footer: "Powered by VeloCap" with brand mark.

#### B7. First-run / empty state (`screens.html` "06 First-run")
- Shown when `recordings.length === 0`.
- Three-step zigzag: Install extension → Record bug → Share replay. Each step with a thumbnail mock.
- Bottom row: "Try sample recording" (loads a fixture), "Watch 30s demo" (linked video).

#### B8. Marketing home (separate page or stays out of scope)
- Hero: huge Instrument Serif italic "Capture the bug. Replay the truth." (or whatever final copy).
- 4-up feature grid, demo screenshot, footer.
- Probably **defer** — we don't have a marketing route in the SPA today and adding one is a larger discussion.

### Layer C — mobile responsive (`screens.html` "07 Mobile")
- Sidebar collapses to bottom tab bar at <768px.
- Stats cards stack 2×2 then 1×4.
- Viewer collapses video on top, tabs below — no resizable panel on mobile.

---

## Suggested execution order

| # | Scope | Effort | Visible impact |
|---|---|---|---|
| 1 | **Layer A** — tokens + fonts swap | 0.5 day | Dashboard immediately reads as "the new design" |
| 2 | **B1** — Dashboard list, stats strip, filter chips | 1 day | The home page tells the new story |
| 3 | **B2** — Recording viewer (minimap + trim bar + restyle) | 2 days | The marquee screen. Highest-impact single change. |
| 4 | **B6** — Public share viewer parity | 0.5 day | External recipients see the new design |
| 5 | **B7** — Empty state | 0.5 day | First impression for new accounts |
| 6 | **C** — Mobile responsive pass | 0.5 day | Recordings viewable on phone |
| 7 | **B5** — Settings rework | 1 day | Needed before API-keys-v2, ties to roadmap |
| 8 | **B4** — Share dialog v2 | 1 day | Needs DB work; do alongside expiry/password backend |
| 9 | **B3** — Review mode | 2 days | Tied to comments feature — defer until comments shipped |
| 10 | **B8** — Marketing home | TBD | Separate decision |

**Suggested first PR scope**: items 1 + 2 + 3 + 6 — about **4 days** of work — covers everything the user sees in the screens-file demo flow and ships the new design in a single coherent slice.

---

## Backlog — additions requested mid-implementation

- **Delete recording from the dashboard** — row action on the list (and the recording detail page). Calls the existing `DELETE /api/recordings/:id` (already implemented and used in dashboard.tsx, but only with a small icon; needs a confirmation prompt + bulk-select integration). Roughly 30 min once we want it. Tracking here so it doesn't get lost.
- **Draggable on-page recording overlay** — IMPLEMENTED. Bar can be dragged anywhere on the page; position persists across reloads.
- **Preview tab instead of in-page iframe** — IMPLEMENTED after the iframe modal silently failed in too many cases. Preview now always opens as a new tab.

## What I'll NOT change

- The Plyr video player itself — keep the current StreamingVideoPlayer behaviour, just restyle its container.
- Underlying React routes / data flow — pure visual refactor.
- The extension UI — design package is dashboard-only.
- The Mouse heatmap — already hidden per your request.

---

## Open questions before I start coding

1. **Light vs dark by default?** Design shows app in dark and the marketing/screen chrome in light. Recommend: dark for the app (recordings/dashboard/settings/share), light for any future marketing page. Confirm OK.
2. **Fonts**: load from Google Fonts (simpler) or self-host (faster, no third-party request)? Recommend Google Fonts for the initial PR; self-host later.
3. **Tag colors** for `bug / review / demo / payments / P0` — the design has implicit semantic mapping. Confirm: bug=coral/err, review=brand-blue, demo=warn-amber, custom=`--surf-3` text=`--text-2`?
4. **The minimap data** for viewer B2: we already store click / console / network / mousemove events. OK to colour them coral / amber / blue / muted respectively per the design?
5. **Scope of first PR**: I recommend items 1+2+3+6 above (~4 days). Acceptable, or do you want a different slice?

Tell me your answers + a green light and I'll start with Layer A.
