# SnapCap - Chrome Extension Install Guide

## How to Install

1. **Open Chrome** and go to `chrome://extensions`
2. **Enable Developer Mode** — toggle it on in the top-right corner
3. Click **"Load unpacked"**
4. Navigate to this folder: `artifacts/chrome-extension`
5. Click **Select Folder** — the extension will appear in your toolbar

> You can pin it to the toolbar by clicking the puzzle piece icon → pin SnapCap

---

## How to Use

### Starting a Recording
1. Click the **SnapCap icon** in your toolbar
2. Choose your options (microphone, network capture, console capture)
3. Click **Start Recording**
4. Chrome will ask you to choose what to share — pick your tab or screen
5. Recording begins! You'll see the timer and live stats update.

### Stopping a Recording
- Click the **SnapCap icon** again and click **Stop & Save**
- Or click the browser's built-in stop button (bottom of screen)

### Viewing Your Recording
- After stopping, click **View Recording** to open the full viewer
- The viewer shows:
  - **Video playback** of your screen
  - **Network logs** — every request, response, status code, and timing
  - **Console logs** — all console output (log, warn, error, info)
  - **Error highlighting** — errors and failed requests are flagged in red
  - **Detail panel** — click any entry to see headers, body, and full details
- Use the **filter tabs** to switch between Network, Errors, Console, or All
- Use the **search bar** to filter logs by URL, method, status, etc.

### Downloading
- Click **Download** from the popup or viewer to get:
  - `.webm` video file (screen recording)
  - `.json` file with all network + console logs

---

## What Gets Captured

| Feature | Details |
|---|---|
| Screen video | Full HD browser tab or full screen |
| Microphone | Optional — toggle in popup |
| Network requests | URL, method, status, headers, request body, duration |
| Network errors | Failed requests, CORS errors, timeouts |
| Console logs | log, warn, error, info, debug |
| Unhandled errors | JS errors and unhandled promise rejections |

---

## Notes

- The extension uses Chrome's built-in `getDisplayMedia` API — no external servers
- All data stays local in Chrome storage
- Videos are stored as WebM (Chrome's native format)
- Large recordings may take a moment to save
