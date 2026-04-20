# Browser-Capture-Jam · Extension

A Chromium MV3 extension that captures the page you're on and packages it into a shareable "Jam":
screenshot **or** screen + microphone video, plus the browser console, network traffic, and device
metadata — all POSTed to a backend as a single envelope.

This folder is only the extension. The backend (`/jams` ingest API + viewer at `/j/:id`) is a
separate service; point `VITE_API_URL` at wherever you're running it.

---

## Features

- 📸 **Screenshot capture** — visible tab, PNG at device pixel ratio.
- 🎥 **Video recording**
  - **Record this tab + mic** — fast path, uses `chrome.tabCapture`, no OS picker.
  - **Record full screen** — uses `getDisplayMedia()`, lets the user pick screen / window / tab from Chrome's native picker.
- 🎙️ **Microphone voice-over** — mixed with system/tab audio via Web Audio when available.
- 🪟 **Floating recording bar** — pulse-dot + live timer + Stop button injected into the active tab while recording.
- 🐛 **Context capture** — console logs (log / info / warn / error / debug), uncaught errors, unhandled rejections, `fetch` + `XMLHttpRequest` calls with headers and timing.
- 💻 **Device metadata** — UA, screen, DPR, viewport, language, timezone, color scheme.
- 🔐 **Server-side redaction** of sensitive headers (Authorization, Cookie, Set-Cookie, anything matching key/token/password/secret/auth/session).
- 🔗 **Permalink** — each Jam gets a shareable URL with a DevTools-style viewer.

## Architecture

```
popup (React)              ─┐
                            ├─► background SW (router + orchestration)
content script (isolated)  ─┤        │
  ↕ window.postMessage      │        ├─► offscreen doc (MediaRecorder)
page-hook (MAIN world)     ─┘        │     — getUserMedia (tab stream)
  — patches console +                │     — getDisplayMedia (full screen)
    fetch + XHR                      │     — Web Audio mix for mic + tab audio
                                     └─► API server (POST /jams envelope)
```

Key design decisions:

- The context hook is registered via a **second `content_scripts` entry with `world: "MAIN"`** — Chrome serves `.ts` files as `video/mp2t`, so `<script src>` injection fails; declarative MAIN-world scripts don't have that problem.
- Recording runs in an **offscreen document** (MV3 service workers can't hold a `MediaStream`).
- Microphone permission is **pre-requested from the popup** (a visible extension page — offscreen docs can't render prompts), then re-used by the offscreen doc.
- Sensitive values are redacted server-side, not client-side, so a compromised page can't see the redacted form.

## Build

```bash
pnpm install
pnpm build           # one-shot: emits extension/dist
pnpm dev             # watch mode
```

## Load in Chrome

1. Build once.
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/dist`.
3. Pin the pink OpenJam icon.
4. Go to any page you want to capture → **reload it** so the content scripts are in place → click the extension icon.

## Config

Point the extension at your backend by setting `VITE_API_URL` before building:

```bash
VITE_API_URL=https://api.example.com pnpm build
```

Defaults to `http://localhost:4000`.

## macOS note

On macOS 14+ every capture API (including `chrome.tabCapture`) requires **Screen Recording**
permission for Chrome itself in System Settings → Privacy & Security → Screen Recording. The
popup surfaces a "Fix screen permission" button that deep-links into that settings pane.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Screenshot the visible tab |
| `scripting` | Re-inject content scripts into tabs opened before install |
| `storage` | Remember the access token + active workspace |
| `tabs` | Query active tab info |
| `tabCapture` | "Record this tab" path |
| `desktopCapture` | Legacy desktop picker fallback (not currently used) |
| `offscreen` | Run `MediaRecorder` off the service worker |
| `<all_urls>` | Auto-inject capture hooks on any page |

## Privacy

- The extension only uploads when the user explicitly clicks Capture / Record.
- Sensitive request/response headers (Authorization, Cookie, etc.) are redacted before storage.
- Mic / screen permissions are granted per-origin by Chrome; the extension never proxies them to a third party.
