# Windows / extension reliability issues — diagnosis + fix plan

**Reported on:** 2026-05-11
**Reporter:** product owner running the extension on Windows + Chrome
**Status:** triage — no fixes applied yet

This document captures six issues observed in the Windows build, ranks them, lists likely root causes, proposes concrete fixes, and tracks decisions. Each section ends with a **Decision needed** prompt — fill it in before we start coding so we don't churn.

---

## Issue 1 — Extension login doesn't "stick" / takes multiple tries

### Symptoms
After signing in via the dashboard popup, the extension UI still shows the unauthenticated state. The user has to retry the login flow several times before the popup acknowledges they are signed in.

### Suspected code paths
- [velo-qa/extension/src/content/auth-callback.ts](velo-qa/extension/src/content/auth-callback.ts) — content script that lives on the dashboard origin and forwards the Clerk token to the service worker via `chrome.runtime.sendMessage`.
- [velo-qa/extension/src/background/index.ts](velo-qa/extension/src/background/index.ts) — MV3 service worker that owns the persisted token (in `chrome.storage.local`).
- [velo-qa/extension/src/popup/App.tsx](velo-qa/extension/src/popup/App.tsx) — popup that reads the token on mount.

### Likely root causes (in order of probability)
1. **Service worker idled out before the auth-callback fired.** MV3 SWs are killed after ~30 s of inactivity. If the dashboard tab finishes Clerk's redirect after the SW is asleep, the `sendMessage` from the content script wakes the SW but the message handler isn't registered yet — the message is dropped. Symptom matches exactly: "have to try many times".
2. **Popup reads auth state once on mount, no live update.** When the user closes the dashboard tab and reopens the popup, the popup pulls from `chrome.storage.local` — if the read races the callback write, the popup shows logged-out. No `chrome.storage.onChanged` listener means stale UI.
3. **Token write succeeds but `chrome.action.setBadgeText` / icon update never runs**, so the user *thinks* it failed and clicks again.
4. **Cross-origin cookie / SameSite issue on Windows Chrome** if the dashboard is on `localhost:3001` and the popup runs from a `chrome-extension://` origin — Edge / Chrome on Windows is stricter about partitioned storage than macOS.

### Proposed fixes
- **F1.1 (highest leverage)** — Convert the auth handshake from "fire-and-forget content-script message" to **`chrome.runtime.connect` + long-lived port** with a retry loop on the content-script side. If the SW is asleep, the connect attempt wakes it and the message replays.
- **F1.2** — Popup subscribes to `chrome.storage.onChanged` for the auth key and re-renders. Closes the race entirely.
- **F1.3** — Service worker writes a visible signal back (badge "✓" for 2 s) so the user has unambiguous confirmation login succeeded.
- **F1.4** — Add a small `?debug=1` query the popup can render so we can see the actual stored auth state during testing.

### How to verify after fix
- chrome://extensions → Service worker → Inspect → keep the devtools open and force-idle (wait 35 s). Repeat the login flow. Should succeed on first try in 5/5 runs.

### Decision needed
- Are you OK with F1.1 + F1.2 + F1.3 bundled (recommended), or want them split into separate PRs?

---

## Issue 2 — Chrome becomes very slow after recording for a while

### Symptoms
Chrome itself (not just the extension) becomes sluggish after the extension has been recording for some time.

### Suspected code paths
- [velo-qa/extension/src/offscreen/index.ts](velo-qa/extension/src/offscreen/index.ts) — MediaRecorder + chunk buffering.
- [velo-qa/extension/src/content/page-hook.ts](velo-qa/extension/src/content/page-hook.ts) — `MAIN`-world hook that captures console, network, and user actions. **This is the suspect.**
- [velo-qa/extension/src/content/index.ts](velo-qa/extension/src/content/index.ts) — content-script wrapper that forwards events.

### Likely root causes
1. **`mousemove` is recorded uncapped**, so on a busy page the event log grows by hundreds of events per second. Each event is JSON-serialised and `postMessage`'d cross-realm.
2. **Event array kept in memory** with no ring-buffer / flush threshold. After 5–10 minutes the in-page hook is holding tens of MB of events, GC stalls become visible.
3. **MediaRecorder timeslice too small** (e.g. 100 ms) generates excessive chunks; each blob append fragments memory.
4. **Console / fetch monkey-patches don't bail out for high-frequency apps** (e.g. analytics SDKs that log thousands of debug lines).

### Proposed fixes
- **F2.1 (must-have)** — Throttle `mousemove` to ~30 Hz (33 ms). Use a single `requestAnimationFrame` aggregator that stores only the last position per frame. Drop intermediate samples.
- **F2.2** — Cap the events buffer at e.g. 50 000 entries with a ring buffer; spill oldest to IndexedDB if needed.
- **F2.3** — Bump MediaRecorder `timeslice` to 1000–2000 ms.
- **F2.4** — Add a per-event-type counter + size accounting visible in the popup ("Events: 12 384 / mouse: 9 102") so we can see the leak in real time.
- **F2.5** — Truncate console-arg serialisation to a max depth + max string length (e.g. 1 KB per arg).

### How to verify
- Open `chrome://memory` and `chrome://crashes`. Record for 10 minutes on a high-traffic page (Twitter/X). Memory should plateau, not grow unbounded.

### Decision needed
- Acceptable to drop intermediate mouse samples (F2.1)? It does mean replay shows a slightly less smooth cursor path — but Issue 5 (capture is missing actions) suggests we currently capture *less* than the user wants anyway, so this needs paired discussion with Issue 5.

---

## Issue 3 — "Copy link" doesn't work until you open Share

### Symptoms
Hitting **Copy link** before opening the **Share** dialog silently fails. After opening Share once, Copy link works.

### Suspected code path
- [artifacts/snapcap-dashboard/src/pages/shared.tsx](artifacts/snapcap-dashboard/src/pages/shared.tsx)
- Whichever recording-list / detail page exposes the inline Copy button.

### Likely root cause
The recording's **public share URL is generated lazily inside the Share modal** (i.e. a "create share token" API call only fires on modal open). Before the modal has run, the Copy button is wired to a `null`/`undefined` URL and silently no-ops.

Other less-likely candidates:
- `navigator.clipboard.writeText` requires a user gesture in some browsers; if the click handler is async-await without proper transient activation propagation, the clipboard write is rejected.

### Proposed fixes
- **F3.1 (most likely fix)** — Fetch / generate the share token on the recording-list render (or on hover, debounced) so Copy link always has a URL. Cache it.
- **F3.2** — If Copy is clicked while the URL is still loading, show a toast "Generating link…" then copy when ready. Never silently no-op.
- **F3.3** — Wrap `navigator.clipboard.writeText` in a fallback that uses a hidden `<textarea>` + `document.execCommand('copy')` on failure (needed on some Windows Chrome corp installs).

### How to verify
- Hard refresh dashboard, hover one recording, click Copy link without opening Share. Should copy and toast "Link copied".

### Decision needed
- Generate share URL eagerly on list render (one API call per recording) or lazily on first hover? Eager is simpler, hover-debounced is cheaper.

---

## Issue 4 — Dashboard slow + "funky" (frozen video, frozen frame, video doesn't play)

### Symptoms
The recordings page sometimes freezes; the video player shows a still frame and won't play; the whole UI feels janky.

### Suspected code paths
- [artifacts/snapcap-dashboard/src/pages/](artifacts/snapcap-dashboard/src/pages/) — recording detail page (uses Plyr per recent `package.json` deps).
- Whichever component fetches the recording's media SAS URL.
- Event-timeline panel that renders alongside the video.

### Likely root causes
1. **The video element is being unmounted / remounted** on every store update (e.g. resizable-panel state, timeline scrub). Plyr re-init is expensive and causes a black frame.
2. **Events list rendered without virtualisation.** A 10-minute recording can have 100 k+ events; rendering them all in one `<ul>` freezes the main thread.
3. **SAS URL expires mid-playback** and the player can't refresh it without a full reload.
4. **Big event payload fetched synchronously** before the page renders — user sees a blank/frozen UI for several seconds.
5. **Source maps + dev mode** in production-feeling testing — but you're hitting Azure dev, not localhost, so this shouldn't apply.

### Proposed fixes
- **F4.1** — Wrap the video container in `React.memo` and stabilise the props (esp. the URL). Confirm Plyr instance survives re-renders. Use `useEffect` cleanup only on URL change, not every render.
- **F4.2** — Virtualise the events list with `@tanstack/react-virtual` (already in catalog). Render only visible rows.
- **F4.3** — Stream events progressively: fetch first 1 000, render, then fetch the rest in the background.
- **F4.4** — Lengthen SAS expiry to e.g. 24 h, and on `media error` automatically request a fresh SAS and rebind.
- **F4.5** — Profile a freeze with the React DevTools Profiler + a 6× CPU throttle, attach the flamegraph to the fix PR.

### How to verify
- Open a 5-minute recording with 50 k events. Page interactive in <2 s, video plays without re-buffering, scrubbing the timeline doesn't drop frames.

### Decision needed
- Is freezing happening on `localhost:3001` (your dev box) or only on the deployed dashboard? Different cause if it's only the deployed one (CDN / SAS / cold start).

---

## Issue 5 — Doesn't always capture mouse clicks, movements, position

### Symptoms
The recording sometimes omits user actions (clicks, mouse motion, mouse position) — and these are critical signal for the product.

### Suspected code paths
- [velo-qa/extension/src/content/page-hook.ts](velo-qa/extension/src/content/page-hook.ts) — installs `addEventListener` for `click`, `mousemove`, etc.
- [velo-qa/extension/src/content/index.ts](velo-qa/extension/src/content/index.ts) — bridges page-hook events to the background.
- [velo-qa/extension/src/manifest.config.ts](velo-qa/extension/src/manifest.config.ts) — content-script `matches` / `run_at`.

### Likely root causes
1. **Page-hook injected too late.** If `run_at` is `document_idle`, the hook misses early clicks on SPAs that auto-redirect.
2. **`mousemove` throttle from the current code is too aggressive** (or in tension with the throttle I want to add in F2.1).
3. **Iframes are not captured.** If the user clicks inside an iframe (Stripe, OAuth popups), the content script doesn't run there. The mouse position relative to the top frame is also wrong.
4. **`useCapture: false`** on the listener means `stopPropagation` from the page swallows the event.
5. **Shadow DOM** — modern component libraries (Lit, Stencil, some Salesforce apps) put their clickables inside shadow roots. Events bubble out but `event.target` is the shadow host, so `target.tagName` looks generic.
6. **The events get captured but dropped during upload** (ties back to Issue 2's buffer cap — events that overflow the buffer never reach the server).

### Proposed fixes
- **F5.1 (highest leverage)** — Re-audit the page-hook event registration: use `{capture: true, passive: true}` on `click`, `pointerdown`, `pointerup`, `pointermove`; install at `document_start` not `document_idle`.
- **F5.2** — Inject the hook into all frames (`all_frames: true` in manifest) and tag each event with its frame URL / origin.
- **F5.3** — Walk shadow roots with `event.composedPath()` so `target` is the real button, not the shadow host.
- **F5.4** — Add an in-popup live counter "mouse: 1 234, click: 18" that updates while recording, so the user can *see* if events are being captured.
- **F5.5** — Switch mouse-position capture to **sample every 33 ms regardless of motion** (so a stationary cursor still shows up) and stamp coordinates with `clientX/Y`, `pageX/Y`, and viewport-normalised `(x/W, y/H)` so replay survives resizing.
- **F5.6** — End-to-end test: a Puppeteer script that drives a fixture page through a known sequence; the upload should contain ≥99 % of the synthetic events.

### How to verify
- The live counter in the popup (F5.4) is the dev-loop short-circuit. Long term: F5.6's e2e test.

### Decision needed
- Is iframe capture in scope right now? It needs more host permissions and probably a fresh CWS review — call this out separately if so.

---

## Issue 6 — General slowness (extension + dashboard)

### Symptoms
"Everything feels slow."

This is mostly the umbrella of Issues 2 + 4, but a few items live only here:

### Likely root causes
1. **Service worker reboot on every popup open** because of MV3 idle behaviour — first popup open after a few seconds idles is always slow.
2. **Bundle size**: the extension dist includes `plyr` twice (33 KB + 113 KB) per the last build log — the preview page is shipping a duplicate copy. The dashboard `index-CuOFd55x.js` is also large (~600 KB+ to render the dashboard landing).
3. **Re-fetches on every nav** — no React Query stale-while-revalidate config, so every route change triggers fresh API calls.
4. **Source-map fetches** in dev mode if you ever hit the dev dashboard from an extension build that thinks it's prod.

### Proposed fixes
- **F6.1** — Wire React Query with `staleTime: 30s` and `gcTime: 5m` on the recordings list.
- **F6.2** — De-duplicate Plyr in the extension bundle (configure `manualChunks` or import once at a shared module).
- **F6.3** — Code-split the dashboard by route (`React.lazy`) — landing / settings / shared can each be their own chunk.
- **F6.4** — Add a perf budget to CI: fail the build if `dist/assets/index.*.js` exceeds e.g. 500 KB gzip.

### Decision needed
- Is "general slow" worth a dedicated perf pass once Issues 1, 4, 5 are fixed (recommended), or do you want F6.1–F6.3 done now?

---

## Issue 7 — Stop button doesn't stop the recording

### Symptoms
Clicking **Stop** in the popup: the button goes disabled, but the timer keeps running and the upload/preview modal never appears. The recording is effectively stuck.

### Suspected code paths
- [velo-qa/extension/src/popup/App.tsx](velo-qa/extension/src/popup/App.tsx) — Stop button → sends `record-stop` message → flips local state to "stopping".
- [velo-qa/extension/src/background/index.ts](velo-qa/extension/src/background/index.ts) — `handleRecordStop` orchestrates: tell offscreen to stop, await final chunk, transition state, open preview tab.
- [velo-qa/extension/src/offscreen/index.ts](velo-qa/extension/src/offscreen/index.ts) — the actual `MediaRecorder.stop()` call + final `dataavailable` chunk.

### Likely root causes (in order)
1. **`MediaRecorder.stop()` never fires its final `dataavailable`** — the offscreen document was already torn down or the recorder was in an unexpected state (`'inactive'`). Background awaits a promise that never resolves → state stays `recording` → timer keeps ticking → preview tab never opens.
2. **Popup's Stop click sends the message but the SW is asleep** — same MV3-idle problem as Issue 1. Button goes disabled (optimistic UI) but the message is dropped. No retry → stuck.
3. **Offscreen document was closed by Chrome** (idle / OOM) so the stop message has no recipient. Background should detect "no offscreen doc" and short-circuit, but might not.
4. **Race with `chrome.tabs.onRemoved` safety net** at [background/index.ts:1068](velo-qa/extension/src/background/index.ts) — if the captured tab is closed during stop, two stop paths run concurrently and one wedges the state machine.
5. **Optimistic disable without an "in flight" timeout** — the button disables forever instead of re-enabling after e.g. 5 s of no progress.

### Proposed fixes
- **F7.1 (must-have)** — In `handleRecordStop`, add a **stop watchdog**: if `MediaRecorder.stop()` hasn't produced a `stop` event within 3 s, force-finalise with whatever chunks we have buffered and proceed to preview. Never leave the state machine pinned to `recording`.
- **F7.2** — Popup's Stop click uses the same long-lived port retry pattern as Issue 1's F1.1, so a sleeping SW can't swallow the click.
- **F7.3** — On Stop, popup re-enables the button after 5 s if no state transition is observed, and surfaces an inline error ("Recording didn't stop cleanly — click to force stop").
- **F7.4** — Add a "force stop" path the user can hit: tears down the offscreen document, resets state to `idle`, dumps whatever blob we have for upload.
- **F7.5** — Log every state transition with a sequence number so we can read `chrome://extensions → service worker → console` after a stuck run and see exactly where it deadlocked.

### How to verify
- Record 30 s, click Stop → preview modal appears within 2 s, 10/10 runs on Windows.
- Force the failure path: open chrome://inspect → manually close the offscreen document mid-recording → click Stop → watchdog kicks in, preview opens with the partial recording.

### Decision needed
- If `MediaRecorder.stop()` times out, do we **upload the partial recording** (F7.1 default) or **discard it and surface an error**? I lean toward upload-partial since it's better than nothing for a bug report.

### Severity
**High** — this is data loss. If the user can't stop, their recording either never uploads or they kill the extension and lose it. Should jump ahead of Issues 2, 3, 4, 6 in the execution order.

---

## Issue 8 — Preview modal hides the Save / Discard buttons

### Symptoms
After Stop, the preview modal opens with the video + Title field, but the action buttons (Save / Discard / Upload) are clipped off the bottom. The modal has no scrollbar so the user can't reach them. Screenshot shows the form ends right where the buttons should be.

### Suspected code paths
- [velo-qa/extension/src/preview/](velo-qa/extension/src/preview/) — preview page that renders inside the modal tab.
- Whatever component wraps `<video>` + `TITLE` input + footer buttons.

### Likely root causes
1. **Modal container has fixed height + `overflow: hidden`** instead of `overflow-y: auto`. On shorter viewports (laptop screens, Windows scaling 125 %/150 %) the footer is clipped.
2. **Footer is absolutely positioned** outside the scroll container, so it gets clipped instead of pushed.
3. **Video element height not capped** — a tall recording pushes the form below the fold.

### Proposed fixes
- **F8.1 (must-have)** — Make the modal body `overflow-y: auto` with a max-height like `calc(100vh - 80px)`. Add `min-height: 0` on the flex parent so children can shrink.
- **F8.2** — Cap the video at e.g. `max-height: 50vh` so the form below is always visible.
- **F8.3** — Make the footer (Save / Discard) **sticky** at the bottom of the modal, so it stays visible regardless of scroll position.

### How to verify
- Open the preview modal on a 720 p display with Windows scaling at 150 %. All buttons must be visible without scrolling, or reachable by a single scroll.

### Severity
**High** — blocks the user from saving the recording. Pairs with Issue 7 as the "stop and save" path is currently broken end-to-end.

---

## Issue 9 — Preview modal needs trim/cut instructions

### Symptoms
The video player has trim handles (the blue draggable bars in the screenshot) but no in-app guidance on how to use them. Users don't know they can trim.

### Suspected code paths
- Same preview component as Issue 8.

### Proposed fixes
- **F9.1** — Add a one-line hint above the player: "Drag the blue handles to trim the start and end. The middle marker is the current playhead." Dismissible with localStorage flag so it doesn't nag after the first use.
- **F9.2** — Tooltip on each trim handle ("Drag to set start" / "Drag to set end").
- **F9.3** — Show the trimmed duration next to the running timestamp ("0:48 · trimmed to 0:25") so users see the trim taking effect.
- **F9.4** — Keyboard shortcuts: `[` sets start at current playhead, `]` sets end. Display them in the hint.

### Severity
**Medium** — feature is reachable, just undiscoverable.

---

## Issue 10 — Auto-fill title from the captured page title

### Symptoms
The TITLE field is empty by default with placeholder text. Most users won't fill it in, leaving recordings hard to find later. The captured page's `<title>` is a much better default.

### Suspected code paths
- Preview component — has access to the recording metadata (page URL, page title were both captured per Issue 1 of the backend log: `pageTitle` is in the schema).
- [velo-qa/extension/src/background/index.ts](velo-qa/extension/src/background/index.ts) — already captures `tab.title` when the recording starts.

### Proposed fixes
- **F10.1 (the fix)** — In the preview component, initialise the title `useState` from `recording.pageTitle` (or `recording.pageUrl` hostname as fallback if title is empty). User can still edit before save.
- **F10.2** — If the user manually clears the field and hits Save, save with an empty title (don't re-inject the default). Track this with an `isUserEdited` flag.
- **F10.3** — Truncate auto-filled titles to e.g. 80 chars with `…` so very long page titles don't break the layout.

### Severity
**Medium** — UX polish, big quality-of-life win for finding recordings later.

---

## Issue 11 — Recorded video quality is bad

### Symptoms
The uploaded recording looks soft / blocky / blurry compared to the live page. Text in the captured tab is hard to read on playback, especially on small fonts and high-DPI displays.

### Suspected code paths
- [velo-qa/extension/src/offscreen/index.ts:462](velo-qa/extension/src/offscreen/index.ts#L462) — `videoBitsPerSecond: 2_000_000` (2 Mbps).
- [velo-qa/extension/src/offscreen/index.ts:325](velo-qa/extension/src/offscreen/index.ts#L325) — tab-capture `getUserMedia` constraints object (no `width`/`height`/`frameRate` — defaults to Chrome's internal pick, usually 720p / 30 fps).
- [velo-qa/extension/src/offscreen/index.ts:363](velo-qa/extension/src/offscreen/index.ts#L363) — display-capture `getDisplayMedia` with `frameRate: { ideal: 30 }` but no resolution hint.
- MediaRecorder `mimeType` chosen at [offscreen/index.ts:306](velo-qa/extension/src/offscreen/index.ts#L306) — currently first-match `video/webm` (likely VP8). VP9 gives much better quality at the same bitrate.

### Likely root causes (in order)
1. **2 Mbps is too low for 1080p / 1440p displays.** Industry references: Loom uses ~4–6 Mbps for 1080p, YouTube 1080p30 minimum is 8 Mbps. At 2 Mbps the encoder smears motion and high-contrast edges.
2. **No explicit resolution constraint** on the source stream — Chrome may downscale to 720p or even 480p depending on the source size and what it thinks the consumer wants.
3. **VP8 codec is preferred** over VP9 / AV1 (current `isTypeSupported` check tries `video/webm` first, which Chrome resolves to VP8). VP9 at the same bitrate is ~30 % sharper.
4. **No `bitsPerSecond` for screen capture path** — same 2 Mbps applies to full-desktop captures where 1440p / 4K is common, making it look even worse.

### Proposed fixes
- **F11.1 (biggest single win)** — Bump `videoBitsPerSecond` from 2 Mbps to a sensible default by source:
  - Tab capture: **5 Mbps**
  - Desktop / display capture: **8 Mbps**
  - Scale down on small streams (≤720p): 3 Mbps so we don't waste bytes.
- **F11.2** — Prefer **VP9** when supported: try `video/webm;codecs=vp9` first, fall back to `video/webm;codecs=vp8`, then `video/webm`. AV1 (`av01`) is even better but encoder is still slow on Windows — skip for now.
- **F11.3** — Add explicit resolution constraints on `getUserMedia` for tab capture: `mandatory.maxWidth: 1920, mandatory.maxHeight: 1080, mandatory.maxFrameRate: 30`. Tab capture defaults are arbitrary.
- **F11.4** — On `getDisplayMedia`, request `{ width: { ideal: 1920 }, height: { ideal: 1080 } }` so Chrome doesn't auto-downscale large displays.
- **F11.5** — Expose a **quality preset** in the popup: Low (3 Mbps), Standard (default), High (10 Mbps). Persist to `chrome.storage.local`. Lets users trade file size for fidelity.
- **F11.6** — Log the chosen `mimeType`, resolution, and bitrate at start so we can verify what was actually used in support cases.

### How to verify after fix
- Record the same fixed page (e.g. a dashboard with small body text) before and after the fix. Open both recordings side-by-side in the preview modal. The "after" should be visibly sharper on text edges and have no blocking in solid backgrounds.
- File-size sanity check: a 30 s 1080p recording at 5 Mbps should land around **18–22 MB**. If it's much smaller, the constraint didn't take.

### Trade-offs / things to watch
- **Bigger files = slower upload.** A 1-minute recording goes from ~15 MB → ~40 MB at the new defaults. Upload time scales linearly. Worth it for the bug-report use case but worth surfacing in the UI ("Uploading 38 MB…").
- **VP9 encoder uses more CPU**, which on weaker Windows laptops (the ones already complaining about Issue 2 / Issue 6 slowness) can become noticeable. Pair with Issue 2's throttling work so we don't make general-slowness worse.
- **Some old Chromes don't support VP9 in WebM container** — fallback chain in F11.2 covers it.

### Severity
**Medium-High** — the recording is the product. If the video is unreadable, the bug report is worthless. Should land alongside or just after Issues 7/8 (which fix the stop+save path; this fix improves what's saved).

### Decision needed
- OK to make uploads ~2.5× larger by default? If not, we ship F11.2 (VP9 codec) alone for a free quality bump at the same bitrate.

---

## Issue 12 — Capture mouse motion + extra UI events, render under a lazy "Mouse" tab in preview

### Symptoms / request
Right now only `click / input / select / submit / navigation` are captured ([velo-qa/extension/src/types.ts:38-52](velo-qa/extension/src/types.ts#L38-L52)). User asked for richer behavioural data, with `mousemove` being the headline addition. Because mousemove is high-volume, the new tab must be **lazy** — not rendered until the user opens it.

### Locked-in scope (from user clarification)
- **Where**: extension preview modal only. Dashboard parity is out of scope for now.
- **Events to capture**:
  - Mouse position sampled at **30 Hz** (every 33 ms, `requestAnimationFrame`-aligned, drop intermediate samples)
  - Clicks + `mousedown` + `mouseup` (button, target selector)
  - Wheel / scroll (`deltaX`, `deltaY`, `scrollTop` of nearest scrollable ancestor)
  - Key presses, **non-typing only** (Tab/Enter/Esc/arrows/F-keys/modifier-with-letter shortcuts). No keystrokes that produce text — privacy.
  - Focus / blur / `visibilitychange` (which element gained focus, when the tab became hidden)
- **Storage**: in-memory during recording, attached to the existing capturedContext payload, uploaded with the rest. **Async only for now** — no live tail, no IndexedDB checkpoint.
- **Render**: tabs in the preview modal (Clicks, Mouse, Wheel, Keys, Focus). Mouse tab uses a virtualised list and is **not mounted** until clicked. All payloads stay in memory after first open (no re-fetch).

### Suspected code paths
- [velo-qa/extension/src/content/page-hook.ts](velo-qa/extension/src/content/page-hook.ts) — where existing actions are emitted. Add the new event handlers here in capture phase.
- [velo-qa/extension/src/content/index.ts](velo-qa/extension/src/content/index.ts) — content-script bridge that forwards page-hook messages to bg.
- [velo-qa/extension/src/types.ts](velo-qa/extension/src/types.ts) — extend `ActionEntry` (or add a parallel `BehaviourEvent` type) and `CapturePayload`.
- [velo-qa/extension/src/preview/index.ts](velo-qa/extension/src/preview/index.ts) — preview UI; add tabs + lazy mount.

### Proposed design (the bit that matters)
- **F12.1 (capture)** — Add a `BehaviourEvent` discriminated union: `{ kind: 'mousemove'; t: number; x: number; y: number }` etc. Keep it separate from `ActionEntry` so the existing dashboard rendering of clicks/inputs doesn't have to learn about mousemove.
- **F12.2 (throttling)** — `mousemove` listener buffers `clientX/clientY` and emits one sample per `requestAnimationFrame` (≈30 Hz native cadence). Drop intermediate raw events. Cap the buffer at e.g. 50 000 entries per recording.
- **F12.3 (transport)** — Reuse the existing `window.postMessage → content-script → chrome.runtime.sendMessage` pipeline. Add `behaviour: BehaviourEvent[]` to `CapturePayload`.
- **F12.4 (UI)** — Tabs above the existing video. Mouse tab is a React-less DOM render (consistent with the rest of `preview/index.ts`). Uses a simple virtual-window: visible 50 rows at a time, scroll listener swaps slice.
- **F12.5 (privacy gate for keys)** — Hard-block any key event whose `target` is `<input>`, `<textarea>`, or `contenteditable`. Only record keys that match the allowlist (Tab/Enter/Esc/arrows/F1-12/modifier-combos without printable letter).
- **F12.6 (server schema)** — Add nullable `behaviour_events JSONB` column to `recordings`. Same migration story as Issue 4's earlier schema drift — push via drizzle. Server stores blob, returns to dashboard later (when we extend dashboard parity).

### Risk / trade-offs
- **Payload size**: a 1-minute recording at 30 Hz mousemove = 1 800 samples × ~24 bytes = ~43 KB. Negligible compared to the video.
- **Page-hook listener overhead**: adding 5 more listeners on the page is cheap, but the `mousemove` capture-phase listener is the hot path. Throttle is non-negotiable.
- **The lazy tab pattern only matters if the events list is huge.** For 50 k mousemoves, naïve rendering does freeze Chrome — virtual scrolling is the whole point of "don't load until requested".
- **Touches the recording schema** — bumps to existing recordings get an empty `behaviour_events`. Add a `?? []` fallback in the reader.

### How to verify
- Record 60 s, click around, scroll, press Tab a few times. Open preview modal. Click each tab — clicks/scroll/keys appear immediately, Mouse tab takes <100 ms to first paint with 1 800 samples virtualised, scrolling the list is smooth.

### Severity
**Medium** — feature request, not a regression. Pairs naturally with Issue 5 (capture reliability) — same `page-hook.ts` file, same listener phase concerns.

### Decision needed
- This is **bigger than the recent CSS / watchdog fixes**. Should I (a) land Issues 1/7/8 first and only then start this, or (b) leave 1/7/8 unmerged and start this now? Recommend (a) — keep the working stop+save path verified before adding new capture code, since this change touches the same `capturedContext` pipeline 7 already modifies.

---

## Suggested execution order

If we just pick the highest-impact items per area:

1. **F1.1 + F1.2 + F1.3** — Auth handshake reliability (Issue 1). One PR. ~Half a day.
2. **F5.1 + F5.3 + F5.4 + F5.5** — Mouse / action capture reliability (Issue 5). One PR. ~Half a day.
3. **F2.1 + F2.3 + F2.5** — Extension memory / Chrome-slowness (Issue 2). One PR. ~Half a day.
4. **F3.1 + F3.2** — Copy-link UX (Issue 3). One PR. ~2 hours.
5. **F4.1 + F4.2 + F4.4** — Dashboard playback + virtualisation (Issue 4). One PR. ~1 day.
6. **F6.1 + F6.2** — Perf cleanup pass (Issue 6). One PR. ~Half a day.

Total rough estimate: **3–4 dev-days** for the headline items, plus a day of verification on Windows.

---

## Open questions for you before we start

1. **Reproduction recordings.** Can you share a Loom (or VeloCap!) of each of issues 1, 4, and 5 on Windows? Visual confirmation will halve debug time.
2. **Windows env specifics.** Which Chrome version, which Windows build (10 / 11 / 11 24H2)? Corp-managed install or personal?
3. **Issue 4 location.** Is the freezing on `http://localhost:3001` (your dev) or on `https://salmon-sea-...azurestaticapps.net` (the deployed dashboard)?
4. **Iframe capture for Issue 5.** In scope or defer?
5. **Bundling vs split PRs.** Want each numbered fix as its own PR for safer rollback, or one big PR per Issue?

When you answer these I'll start with whichever issue you mark "do this first."
