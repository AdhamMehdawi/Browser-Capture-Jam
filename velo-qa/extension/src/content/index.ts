// Content script (isolated world). Two jobs:
//   1. Inject page-hook.ts into the MAIN world so we can see console/fetch/XHR
//      as they fire (hooks cannot cross worlds).
//   2. Buffer hook events + respond to the popup's "capture-context" request.

import type { ActionEntry, CapturePayload, ConsoleEntry, DeviceInfo, NetworkEntry } from '../types.js';
import { MSG } from '../types.js';

const HOOK_TAG = 'velocap/hook';
const CONSOLE_MAX = 500;
const NETWORK_MAX = 300;
// Issue 12: with mousemove sampled at ~30 Hz, a 1-minute recording adds
// ~1800 entries. Raise the cap so legitimate clicks/keys/scrolls don't
// get evicted by mouse motion in normal recordings.
const ACTIONS_MAX = 5000;

const consoleBuffer: ConsoleEntry[] = [];
const networkPending = new Map<string, Partial<NetworkEntry>>();
const networkBuffer: NetworkEntry[] = [];
const actionsBuffer: ActionEntry[] = [];

// The MAIN-world hook now runs automatically via a separate content_scripts
// entry in the manifest (world: 'MAIN'). We just listen for its messages.

// eslint-disable-next-line no-console
console.info(
  '%c[VeloCap] content script ready',
  'color:#ff4d7e;font-weight:bold',
);

// --- Buffer events coming out of the hook.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { tag?: string; kind?: string; payload?: unknown } | null;
  if (!data || data.tag !== HOOK_TAG) return;

  // Debug: log received events
  // eslint-disable-next-line no-console
  console.debug('[velocap/content] received hook event', data.kind, data.payload);

  if (data.kind === 'console' || data.kind === 'error' || data.kind === 'unhandledrejection') {
    const entry = data.payload as ConsoleEntry;
    consoleBuffer.push(entry);
    if (consoleBuffer.length > CONSOLE_MAX) consoleBuffer.shift();
  } else if (data.kind === 'network-start') {
    const p = data.payload as NetworkEntry;
    networkPending.set(p.id, p);
  } else if (data.kind === 'network-end') {
    const end = data.payload as Partial<NetworkEntry> & { id: string };
    const start = networkPending.get(end.id);
    if (!start) return;
    networkPending.delete(end.id);
    networkBuffer.push({ ...start, ...end } as NetworkEntry);
    if (networkBuffer.length > NETWORK_MAX) networkBuffer.shift();
  } else if (data.kind === 'action') {
    const a = data.payload as ActionEntry;
    // Coalesce rapid duplicate navigations (e.g. pushState storms).
    if (a.type === 'navigation') {
      const last = actionsBuffer[actionsBuffer.length - 1];
      if (last && last.type === 'navigation' && last.url === a.url) return;
    }
    actionsBuffer.push(a);
    if (actionsBuffer.length > ACTIONS_MAX) {
      // Issue 2: when the buffer is full, prefer dropping an old mousemove
      // (high-volume, low signal) over losing clicks/keys/navigations
      // (rare, high signal).
      const idx = actionsBuffer.findIndex((e) => e.type === 'mousemove');
      if (idx !== -1) {
        actionsBuffer.splice(idx, 1);
      } else {
        actionsBuffer.shift();
      }
    }
  }
});

function collectDevice(): DeviceInfo {
  const dpr = window.devicePixelRatio || 1;
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return {
    userAgent: navigator.userAgent,
    platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform,
    language: navigator.language,
    languages: Array.from(navigator.languages ?? []),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      dpr,
      colorDepth: window.screen.colorDepth,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    colorScheme,
  };
}

function masked(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    if (t === 'password' || t === 'email' || t === 'tel') return true;
    if (el.autocomplete?.toLowerCase().includes('cc-')) return true;
  }
  if ((el as HTMLElement).closest?.('[data-jam-mask]')) return true;
  return false;
}

// Placeholder — FR-S2 currently covers input MASKING only for values we
// explicitly capture. We don't snapshot inputs in this MVP, but we export
// the predicate so Phase 3.7 can plug in.
void masked;

function collectPayload(): CapturePayload {
  // eslint-disable-next-line no-console
  console.log('[velocap/content] collectPayload called', {
    consoleCount: consoleBuffer.length,
    networkCount: networkBuffer.length,
    actionsCount: actionsBuffer.length,
  });
  return {
    console: consoleBuffer.slice(),
    network: networkBuffer.slice(),
    actions: actionsBuffer.slice(),
    device: collectDevice(),
    page: {
      url: window.location.href,
      title: document.title,
      referrer: document.referrer || undefined,
    },
  };
}

// ============================================================
// Recording overlay — a floating shadow-DOM bar on the page
// with a live timer and a stop button. Driven by BG messages.
// ============================================================

let overlayHost: HTMLDivElement | null = null;
let overlayTimerEl: HTMLSpanElement | null = null;
let overlayStopBtn: HTMLButtonElement | null = null;
let overlayStartedAt = 0;
let overlayInterval: number | null = null;

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function showOverlay(startedAt: number): void {
  if (overlayHost) return; // already shown
  overlayStartedAt = startedAt || Date.now();

  overlayHost = document.createElement('div');
  overlayHost.setAttribute('data-velocap-overlay', '');
  overlayHost.style.cssText =
    'all: initial; position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: auto;';

  const root = overlayHost.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .bar {
        display: inline-flex; align-items: center; gap: 10px;
        padding: 8px 14px;
        background: #ffffff; color: #1a1a2e;
        border: 1px solid #e5e7eb; border-radius: 999px;
        font: 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06);
        user-select: none;
      }
      .logo { height: 18px; width: auto; flex-shrink: 0; }
      .dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #ef4444;
        animation: pulse 1s infinite ease-in-out;
      }
      .timer { font-variant-numeric: tabular-nums; color: #6b7280; min-width: 34px; text-align: center; font-weight: 500; }
      button {
        background: #7c3aed; color: #ffffff; border: 0; border-radius: 6px;
        padding: 6px 14px; font: inherit; font-weight: 600; cursor: pointer;
        transition: background 0.15s;
      }
      button:disabled { background: #e5e7eb; color: #9ca3af; cursor: default; }
      button:hover:not(:disabled) { background: #6d28d9; }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.4; transform: scale(1.5); }
      }
    </style>
    <div class="bar" role="status" aria-live="polite">
      <svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="350 90 300 250"><path fill="#7c3aed" d="M546.778381,143.170624C571.837769,159.376846 596.645569,175.305298 621.322937,191.433304C636.009155,201.031509 635.978516,216.712524 621.371460,226.194397C576.110229,255.574753 530.847717,284.953583 485.503937,314.206238C472.276642,322.739563 459.865479,318.754028 453.794159,304.396240C425.790985,238.172882 397.800232,171.944290 369.830170,105.706955C369.077332,103.924194 367.954132,102.184967 368.359497,99.792320C371.491486,98.422760 374.856354,99.127960 378.098694,99.068153C385.426880,98.932976 392.763336,99.161888 400.087982,98.950737C403.767334,98.844666 405.815216,100.090027 407.237396,103.618439C417.878113,130.018570 428.701080,156.345245 439.462555,182.696701C444.289581,194.516510 449.106537,206.340408 454.767395,218.077042C454.767395,210.186707 454.769012,202.296356 454.767090,194.406006C454.761017,169.581909 454.815948,144.757568 454.710480,119.933884C454.677002,112.059120 456.822998,105.459862 464.040466,101.364922C471.543579,97.107903 478.433380,99.167374 485.133606,103.492462C505.562927,116.679909 526.023499,129.818924 546.778381,143.170624M487.077606,177.500229C487.088318,196.659058 487.097656,215.817871 487.110474,234.976700C487.115601,242.640198 486.990417,250.307053 487.176819,257.966248C487.361481,265.554352 493.136444,268.822632 499.920197,265.331207C501.841492,264.342316 503.688873,263.195923 505.509277,262.026917C523.025391,250.778488 540.529297,239.510925 558.034729,228.245773C561.167725,226.229553 564.291687,224.199097 568.479797,221.489456C565.252991,238.021347 557.077332,250.810303 549.042114,263.705475C555.025513,258.754944 560.207947,253.170654 564.589417,246.857254C574.476318,232.610870 581.915833,217.562714 579.724915,199.476318C578.750366,191.431412 575.671753,184.236603 570.779297,177.840118C572.674500,186.055344 575.610046,194.033020 574.522217,203.760239C570.794800,199.851517 568.074524,196.773041 564.520142,194.506149C556.095520,189.133087 547.900330,183.401398 539.506714,177.978363C526.497131,169.573074 513.505432,161.131058 500.296631,153.047012C493.184265,148.694077 487.352753,152.185699 487.141632,160.507706C487.006470,165.835632 487.099609,171.169327 487.077606,177.500229z"/><path fill="#ef4444" d="M516.001099,189.525391C527.921936,187.016037 537.708862,192.994354 540.377869,204.043137C543.029785,215.020767 537.080444,225.186371 526.369263,227.979706C515.840759,230.725403 505.525635,224.949127 502.393585,214.553787C499.126343,203.709702 504.189117,194.169617 516.001099,189.525391z"/></svg>
      <span class="dot" aria-hidden="true"></span>
      <span class="timer" id="oj-timer">0:00</span>
      <button id="oj-stop">Stop</button>
    </div>
  `;
  (document.documentElement || document.body).appendChild(overlayHost);

  overlayTimerEl = root.getElementById('oj-timer') as HTMLSpanElement;
  overlayStopBtn = root.getElementById('oj-stop') as HTMLButtonElement;
  overlayStopBtn.addEventListener('click', () => {
    if (!overlayStopBtn) return;
    overlayStopBtn.disabled = true;
    overlayStopBtn.textContent = 'Stopping…';
    // Fix Issue 7 (round 2): previously this was fire-and-forget, so when bg
    // hung the overlay stayed on "Stopping…" forever with no user feedback.
    // Now we await the response and self-clean after a hard local timeout.
    const localTimeoutMs = 35_000; // > bg watchdog so bg has priority
    const localTimer = window.setTimeout(() => {
      console.warn('[velocap/overlay] local stop timeout — hiding overlay');
      hideOverlay();
    }, localTimeoutMs);
    chrome.runtime
      .sendMessage({ kind: 'bg:record-stop' })
      .then(() => {
        window.clearTimeout(localTimer);
        // bg will broadcast 'overlay:hide' on success, but if it didn't
        // (e.g. bg sent watchdog error), hide locally as a safety net.
        if (overlayStopBtn) hideOverlay();
      })
      .catch((e) => {
        window.clearTimeout(localTimer);
        console.warn('[velocap/overlay] stop sendMessage failed:', e);
        hideOverlay();
      });
  });

  const tick = () => {
    if (overlayTimerEl) overlayTimerEl.textContent = fmtElapsed(Date.now() - overlayStartedAt);
  };
  tick();
  overlayInterval = window.setInterval(tick, 500);
}

function hideOverlay(): void {
  if (overlayInterval != null) {
    window.clearInterval(overlayInterval);
    overlayInterval = null;
  }
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
    overlayTimerEl = null;
    overlayStopBtn = null;
  }
}

// ============================================================
// Post-recording preview modal
//   After MediaRecorder.onstop the offscreen doc hands the blob
//   to BG, BG calls showPreview() on this tab. The user then
//   decides: Upload → server, Download → local file, Discard.
// ============================================================
let previewHost: HTMLDivElement | null = null;
let previewMessageHandler: ((ev: MessageEvent) => void) | null = null;

function hidePreview(): void {
  if (previewMessageHandler) {
    window.removeEventListener('message', previewMessageHandler);
    previewMessageHandler = null;
  }
  if (!previewHost) return;
  previewHost.remove();
  previewHost = null;
}

/**
 * Show the preview as an in-page popup (modal + backdrop) — but the actual
 * content is an <iframe> loading our extension-origin preview page. That's
 * the trick: the page you were on might have a strict CSP blocking data:
 * and blob: media, but the iframe is chrome-extension://<id> origin so its
 * own CSP applies, which permits everything the preview page needs.
 *
 * The iframe talks back via window.postMessage so we can close the modal
 * when the user hits Discard / Close.
 */
function showPreview(_msg: {
  readSasUrl?: string;
  screenshotDataUrl?: string;
  mimeType?: string;
  mediaType?: string;
  durationMs?: number;
  bytes?: number;
  note?: string;
}): void {
  hidePreview();
  hideOverlay();

  const previewUrl = chrome.runtime.getURL('src/preview/index.html') + '?embed=1';

  previewHost = document.createElement('div');
  previewHost.setAttribute('data-velocap-preview', '');
  previewHost.style.cssText =
    'all: initial; position: fixed; inset: 0; z-index: 2147483647;';

  const root = previewHost.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        position: fixed; inset: 0;
        background: rgba(0,0,0,.72);
        backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
        animation: fade .15s ease-out;
      }
      .frame {
        width: min(960px, 100%);
        height: min(720px, 85vh);
        border: 1px solid #22283a;
        border-radius: 14px;
        overflow: hidden;
        background: #0b0d12;
        box-shadow: 0 24px 80px rgba(0,0,0,.6);
      }
      iframe { width: 100%; height: 100%; border: 0; display: block; background: #0b0d12; }
      @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
    </style>
    <div class="backdrop">
      <div class="frame">
        <iframe
          src="${previewUrl}"
          allow="autoplay; clipboard-write"
          title="VeloCap preview"
        ></iframe>
      </div>
    </div>
  `;

  (document.documentElement || document.body).appendChild(previewHost);

  // The iframe posts messages at us when the user hits close/discard/upload
  // completion. We only listen for our own tagged messages from that frame.
  previewMessageHandler = (ev: MessageEvent): void => {
    const data = ev.data as { tag?: string; action?: string } | null;
    if (!data || data.tag !== 'velocap/preview') return;
    if (data.action === 'close') hidePreview();
  };
  window.addEventListener('message', previewMessageHandler);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === MSG.capture) {
    sendResponse(collectPayload());
    return true;
  }
  if (msg?.kind === 'overlay:show') {
    showOverlay(msg.startedAt);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.kind === 'overlay:hide') {
    hideOverlay();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.kind === 'preview:show') {
    void showPreview(msg);
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.kind === 'preview:hide') {
    hidePreview();
    sendResponse({ ok: true });
    return false;
  }
  return undefined;
});

// ============================================================
// Re-attach the overlay after navigations.
//   The content script runs fresh on every document load, but
//   the overlay lives in DOM and gets wiped with it. Ask the
//   background if a recording is active and, if so, re-inject.
//   Also handles SPA pushState nav where document doesn't
//   reload but we arrive here only once per real load.
// ============================================================
(function reattachOverlayIfRecording(): void {
  try {
    chrome.runtime
      .sendMessage({ kind: 'bg:state' })
      .then((s: { state?: string; startedAt?: number } | undefined) => {
        if (s?.state === 'recording' && typeof s.startedAt === 'number') {
          showOverlay(s.startedAt);
        }
      })
      .catch(() => {
        // Background worker may be starting up; retry once shortly.
        setTimeout(() => {
          chrome.runtime
            .sendMessage({ kind: 'bg:state' })
            .then((s: { state?: string; startedAt?: number } | undefined) => {
              if (s?.state === 'recording' && typeof s.startedAt === 'number') {
                showOverlay(s.startedAt);
              }
            })
            .catch(() => undefined);
        }, 400);
      });
  } catch {
    // extension context unavailable (e.g. about:blank during nav) — ignore
  }
})();
