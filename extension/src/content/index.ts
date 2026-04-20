// Content script (isolated world). Two jobs:
//   1. Inject page-hook.ts into the MAIN world so we can see console/fetch/XHR
//      as they fire (hooks cannot cross worlds).
//   2. Buffer hook events + respond to the popup's "capture-context" request.

import type { CapturePayload, ConsoleEntry, DeviceInfo, NetworkEntry } from '../types.js';
import { MSG } from '../types.js';

const HOOK_TAG = 'openjam/hook';
const CONSOLE_MAX = 500;
const NETWORK_MAX = 300;

const consoleBuffer: ConsoleEntry[] = [];
const networkPending = new Map<string, Partial<NetworkEntry>>();
const networkBuffer: NetworkEntry[] = [];

// The MAIN-world hook now runs automatically via a separate content_scripts
// entry in the manifest (world: 'MAIN'). We just listen for its messages.

// eslint-disable-next-line no-console
console.info(
  '%c[OpenJam] content script ready',
  'color:#ff4d7e;font-weight:bold',
);

// --- Buffer events coming out of the hook.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { tag?: string; kind?: string; payload?: unknown } | null;
  if (!data || data.tag !== HOOK_TAG) return;

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
  return {
    console: consoleBuffer.slice(),
    network: networkBuffer.slice(),
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
  overlayHost.setAttribute('data-openjam-overlay', '');
  overlayHost.style.cssText =
    'all: initial; position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: auto;';

  const root = overlayHost.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .bar {
        display: inline-flex; align-items: center; gap: 10px;
        padding: 8px 12px;
        background: #0b0d12; color: #e6e9ef;
        border: 1px solid #22283a; border-radius: 999px;
        font: 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,0.35);
        user-select: none;
      }
      .brand { font-weight: 700; letter-spacing: .2px; }
      .brand b { color: #ff4d7e; }
      .dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #ff4d7e;
        animation: pulse 1s infinite ease-in-out;
      }
      .timer { font-variant-numeric: tabular-nums; color: #9aa3b2; min-width: 34px; text-align: center; }
      button {
        background: #ff4d7e; color: #1a0914; border: 0; border-radius: 6px;
        padding: 6px 12px; font: inherit; font-weight: 600; cursor: pointer;
      }
      button:disabled { background: #22283a; color: #9aa3b2; cursor: default; }
      button:hover:not(:disabled) { filter: brightness(1.08); }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.4; transform: scale(1.5); }
      }
    </style>
    <div class="bar" role="status" aria-live="polite">
      <span class="dot" aria-hidden="true"></span>
      <span class="brand">Open<b>Jam</b></span>
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
    overlayStopBtn.textContent = 'Uploading…';
    void chrome.runtime.sendMessage({ kind: 'bg:record-stop' });
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
  return undefined;
});
