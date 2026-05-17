// Runs in the PAGE'S MAIN world. This is where console + fetch + XHR must
// be patched — the isolated-world content script can't see the page's global
// console. We forward events back to the content script via window.postMessage.

import { sanitizeHeaders, sanitizeBody, sanitizeConsoleMessage } from './sanitize';

const TAG = 'velocap/hook';

// Visible marker so users can confirm the hook installed.
// eslint-disable-next-line no-console
console.info('%c[VeloCap] page-hook installed', 'color:#ff4d7e;font-weight:bold');
(window as unknown as { __velocap?: { hook: boolean } }).__velocap = {
  ...((window as unknown as { __velocap?: object }).__velocap ?? {}),
  hook: true,
};

// ============================================================
// Action capture — clicks, inputs, submits, navigations.
//   Records each with a ranked list of selectors plus enough
//   target metadata that downstream exporters (Cypress,
//   Playwright, Puppeteer) can regenerate the same action.
// ============================================================

function cssEscapeIdent(s: string): string {
  // Narrow CSS.escape polyfill — the real thing is in all modern browsers.
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function looksDynamicId(id: string): boolean {
  // "radix-:r1:", UUIDs, numeric-only, long hex strings — skip as unstable.
  if (/^\d+$/.test(id)) return true;
  if (/^[a-f0-9]{8}-?[a-f0-9]{4,}/i.test(id)) return true;
  if (/(^|:|-|_)r\d+/.test(id)) return true;
  if (id.length > 48) return true;
  return false;
}

function nthOfType(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return el.tagName.toLowerCase();
  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (siblings.length === 1) return el.tagName.toLowerCase();
  const idx = siblings.indexOf(el) + 1;
  return `${el.tagName.toLowerCase()}:nth-of-type(${idx})`;
}

function fullPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML' && parts.length < 8) {
    parts.unshift(nthOfType(cur));
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function buildSelectors(el: Element): { primary: string; alternates: string[] } {
  const candidates: string[] = [];

  // 1. Test-id attributes (most stable).
  for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
    const v = el.getAttribute(attr);
    if (v) candidates.push(`[${attr}="${v.replace(/"/g, '\\"')}"]`);
  }

  // 2. Accessibility attributes.
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) candidates.push(`[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`);
  const role = el.getAttribute('role');
  if (role && ariaLabel) candidates.push(`[role="${role}"][aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`);

  // 3. Stable id.
  if (el.id && !looksDynamicId(el.id)) {
    candidates.push(`#${cssEscapeIdent(el.id)}`);
  }

  // 4. Name attribute — common on form fields.
  const name = el.getAttribute('name');
  if (name) candidates.push(`${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`);

  // 5. Type attribute for specific inputs (e.g. input[type="submit"]).
  if (el.tagName === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    if (t && ['submit', 'reset', 'checkbox', 'radio'].includes(t)) {
      candidates.push(`input[type="${t}"]`);
    }
  }

  // 6. href for anchors.
  if (el.tagName === 'A') {
    const href = (el as HTMLAnchorElement).getAttribute('href');
    if (href && href.length < 80 && !href.startsWith('#')) {
      candidates.push(`a[href="${href.replace(/"/g, '\\"')}"]`);
    }
  }

  // 7. Full DOM path as last-resort fallback.
  candidates.push(fullPath(el));

  const primary = candidates[0] ?? 'body';
  return { primary, alternates: candidates.slice(1, 4) };
}

function isOwnUi(el: Element): boolean {
  return !!el.closest?.('[data-velocap-overlay], [data-velocap-preview]');
}

function shouldMask(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    const t = (el.type || '').toLowerCase();
    if (t === 'password' || t === 'email' || t === 'tel') return true;
    const ac = (el.autocomplete || '').toLowerCase();
    if (ac.includes('cc-') || ac === 'current-password' || ac === 'new-password') return true;
  }
  return !!el.closest?.('[data-jam-mask]');
}

function targetMeta(el: Element): {
  tag: string;
  text?: string;
  role?: string;
  inputType?: string;
  name?: string;
} {
  const text = (el.textContent || '').trim().slice(0, 40) || undefined;
  const meta: ReturnType<typeof targetMeta> = { tag: el.tagName.toLowerCase() };
  if (text) meta.text = text;
  const role = el.getAttribute('role');
  if (role) meta.role = role;
  if (el instanceof HTMLInputElement) meta.inputType = el.type;
  const name = el.getAttribute('name');
  if (name) meta.name = name;
  return meta;
}

// --- click ---
// Fix Issue 5: previously read `e.target` only, which on shadow-DOM components
// (Lit, Stencil, Salesforce LWC, many design systems) is the *shadow host*,
// not the inner button the user actually clicked — so selectors pointed at a
// generic wrapper and many real targets looked the same. `composedPath()[0]`
// returns the deepest element including across open shadow roots.
function resolveEventTarget(e: Event): Element | null {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  for (const node of path) {
    if (node instanceof Element) return node;
  }
  return e.target instanceof Element ? e.target : null;
}

document.addEventListener(
  'click',
  (e) => {
    const el = resolveEventTarget(e);
    if (!el) return;
    if (isOwnUi(el)) return;
    if ((e as MouseEvent).isTrusted === false) return;
    const { primary, alternates } = buildSelectors(el);
    post('action', {
      type: 'click',
      selector: primary,
      selectorAlts: alternates,
      target: targetMeta(el),
      url: location.href,
      timestamp: Date.now(),
    });
  },
  true, // capture phase — see events even if the page stops propagation
);

// ============================================================
// Issue 12 — extra UI events (mouse motion, wheel, keys, focus,
// visibility). All passive listeners with strict throttling so
// they can't degrade page performance (Issue 2 protection).
// ============================================================

// --- mousemove: sampled at ~30 Hz via requestAnimationFrame ---
// Keep only the LAST mouse position per animation frame. On a 60 Hz monitor
// this yields ~60 samples/sec native; we step down to 30 with a toggle.
{
  let pendingX = 0;
  let pendingY = 0;
  let pending = false;
  let frameToggle = false;
  const flush = () => {
    pending = false;
    // Sample every OTHER frame ≈ 30 Hz on a 60 Hz monitor.
    frameToggle = !frameToggle;
    if (frameToggle) return;
    post('action', {
      type: 'mousemove',
      x: pendingX,
      y: pendingY,
      url: location.href,
      timestamp: Date.now(),
    });
  };
  document.addEventListener(
    'mousemove',
    (e) => {
      if ((e as MouseEvent).isTrusted === false) return;
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (!pending) {
        pending = true;
        requestAnimationFrame(flush);
      }
    },
    { capture: true, passive: true },
  );
}

// --- mousedown / mouseup ---
for (const evt of ['mousedown', 'mouseup'] as const) {
  document.addEventListener(
    evt,
    (e) => {
      const me = e as MouseEvent;
      if (me.isTrusted === false) return;
      const el = resolveEventTarget(e);
      if (el && isOwnUi(el)) return;
      post('action', {
        type: evt,
        x: me.clientX,
        y: me.clientY,
        button: me.button,
        ...(el ? { target: targetMeta(el) } : {}),
        url: location.href,
        timestamp: Date.now(),
      });
    },
    { capture: true, passive: true },
  );
}

// --- wheel: debounced 150ms so a flick of the wheel = 1 event, not 60 ---
{
  let lastEmitted = 0;
  let acc = { dx: 0, dy: 0 };
  document.addEventListener(
    'wheel',
    (e) => {
      const we = e as WheelEvent;
      if (we.isTrusted === false) return;
      acc.dx += we.deltaX;
      acc.dy += we.deltaY;
      const now = Date.now();
      if (now - lastEmitted < 150) return;
      lastEmitted = now;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      post('action', {
        type: 'wheel',
        deltaX: Math.round(acc.dx),
        deltaY: Math.round(acc.dy),
        scrollTop,
        url: location.href,
        timestamp: now,
      });
      acc = { dx: 0, dy: 0 };
    },
    { capture: true, passive: true },
  );
}

// --- keydown: non-typing keys only (privacy: never record text input) ---
const NON_TYPING_KEYS = new Set([
  'Tab', 'Enter', 'Escape', 'Backspace', 'Delete',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);
document.addEventListener(
  'keydown',
  (e) => {
    const ke = e as KeyboardEvent;
    if (ke.isTrusted === false) return;
    // Hard-block: never record any keydown while typing into an input,
    // textarea, or contenteditable — even non-printable keys we'd
    // otherwise allow (someone hitting Enter to submit a password form
    // could leak timing info if combined with other signals).
    const t = ke.target as Element | null;
    if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t as HTMLElement).isContentEditable)) {
      return;
    }
    // Allow modifier+letter shortcuts (e.g. Cmd+S, Ctrl+K) but not bare
    // printable letters (would be typing).
    const printable = ke.key.length === 1 && !ke.ctrlKey && !ke.metaKey;
    if (!NON_TYPING_KEYS.has(ke.key) && printable) return;
    post('action', {
      type: 'keydown',
      key: ke.key,
      ctrl: ke.ctrlKey || undefined,
      shift: ke.shiftKey || undefined,
      alt: ke.altKey || undefined,
      meta: ke.metaKey || undefined,
      url: location.href,
      timestamp: Date.now(),
    });
  },
  { capture: true, passive: true },
);

// --- focus / blur (delegated; only meaningful elements) ---
for (const evt of ['focus', 'blur'] as const) {
  document.addEventListener(
    evt,
    (e) => {
      const el = e.target as Element | null;
      if (!el || !(el instanceof Element)) return;
      if (isOwnUi(el)) return;
      // Only emit for interactive elements — otherwise it's spam from
      // window/document focus changes.
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLButtonElement)) {
        return;
      }
      const { primary } = buildSelectors(el);
      post('action', {
        type: evt,
        selector: primary,
        target: targetMeta(el),
        state: evt,
        url: location.href,
        timestamp: Date.now(),
      });
    },
    true, // capture phase: focus events don't bubble by default
  );
}

// --- page visibility ---
document.addEventListener(
  'visibilitychange',
  () => {
    post('action', {
      type: 'visibility',
      state: document.hidden ? 'hidden' : 'visible',
      url: location.href,
      timestamp: Date.now(),
    });
  },
  { passive: true },
);

// --- input (debounced per element) ---
const inputFlushTimers = new WeakMap<Element, number>();
const inputFinalValues = new WeakMap<Element, string>();

function flushInput(el: Element): void {
  const value = inputFinalValues.get(el) ?? '';
  inputFinalValues.delete(el);
  inputFlushTimers.delete(el);
  const masked = shouldMask(el);
  const { primary, alternates } = buildSelectors(el);
  post('action', {
    type: 'input',
    selector: primary,
    selectorAlts: alternates,
    target: targetMeta(el),
    value: masked ? '[masked]' : value.slice(0, 200),
    url: location.href,
    timestamp: Date.now(),
  });
}

document.addEventListener(
  'input',
  (e) => {
    const el = e.target as Element | null;
    if (!el || !(el instanceof Element)) return;
    if (isOwnUi(el)) return;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
    inputFinalValues.set(el, (el as HTMLInputElement).value);
    const prev = inputFlushTimers.get(el);
    if (prev) window.clearTimeout(prev);
    inputFlushTimers.set(el, window.setTimeout(() => flushInput(el), 400));
  },
  true,
);

// --- select (for <select>) ---
document.addEventListener(
  'change',
  (e) => {
    const el = e.target as Element | null;
    if (!el || !(el instanceof HTMLSelectElement)) return;
    if (isOwnUi(el)) return;
    const { primary, alternates } = buildSelectors(el);
    post('action', {
      type: 'select',
      selector: primary,
      selectorAlts: alternates,
      target: targetMeta(el),
      value: el.value,
      url: location.href,
      timestamp: Date.now(),
    });
  },
  true,
);

// --- submit ---
document.addEventListener(
  'submit',
  (e) => {
    const el = e.target as Element | null;
    if (!el || !(el instanceof HTMLFormElement)) return;
    if (isOwnUi(el)) return;
    const { primary, alternates } = buildSelectors(el);
    post('action', {
      type: 'submit',
      selector: primary,
      selectorAlts: alternates,
      target: targetMeta(el),
      url: location.href,
      timestamp: Date.now(),
    });
  },
  true,
);

// --- navigation: pushState / replaceState / popstate ---
function wrapHistory(method: 'pushState' | 'replaceState'): void {
  const original = history[method].bind(history);
  history[method] = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    original(data, unused, url as string);
    post('action', {
      type: 'navigation',
      selector: '',
      target: { tag: 'document' },
      url: location.href,
      timestamp: Date.now(),
    });
  };
}
wrapHistory('pushState');
wrapHistory('replaceState');
window.addEventListener('popstate', () => {
  post('action', {
    type: 'navigation',
    selector: '',
    target: { tag: 'document' },
    url: location.href,
    timestamp: Date.now(),
  });
});

// Fire one "load" nav so exporters know the starting URL.
post('action', {
  type: 'navigation',
  selector: '',
  target: { tag: 'document' },
  url: location.href,
  timestamp: Date.now(),
});

interface HookEvent {
  tag: typeof TAG;
  kind: 'console' | 'network-start' | 'network-end' | 'error' | 'unhandledrejection';
  payload: unknown;
}

function post(kind: HookEvent['kind'], payload: unknown): void {
  window.postMessage({ tag: TAG, kind, payload } satisfies HookEvent, '*');
}

function safeStringify(v: unknown, max = 2_000): string {
  try {
    if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v;
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (v === undefined) return 'undefined';
    const s = JSON.stringify(v, (_k, val) => {
      if (val instanceof Error) return `${val.name}: ${val.message}`;
      if (typeof val === 'bigint') return `${val.toString()}n`;
      if (typeof val === 'function') return `[fn ${val.name || 'anonymous'}]`;
      return val;
    });
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return String(v);
  }
}

// ---- console ----
(['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    try {
      const rendered = args.map((a) => sanitizeConsoleMessage(safeStringify(a)));
      post('console', {
        level,
        message: rendered.join(' '),
        args: rendered,
        stack: level === 'error' ? new Error().stack : undefined,
        timestamp: Date.now(),
      });
    } catch {
      // never break the page
    }
    original(...args);
  };
});

window.addEventListener('error', (e) => {
  post('error', {
    level: 'error',
    message: sanitizeConsoleMessage(e.message || 'Uncaught error'),
    stack: e.error instanceof Error ? e.error.stack : undefined,
    timestamp: Date.now(),
    source: 'error',
  });
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  post('unhandledrejection', {
    level: 'error',
    message: sanitizeConsoleMessage(`Unhandled rejection: ${safeStringify(reason)}`),
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: Date.now(),
    source: 'unhandledrejection',
  });
});

// ---- fetch ----
const BODY_CAP = 50_000; // chars — enough to debug most JSON / form payloads

// Fix Issue 13: hosts/paths known to use streaming media or byte-range fetches.
// We skip even the metadata log to avoid any chance of disturbing MSE-based
// players. The user is virtually never debugging a bug "inside the YouTube
// player" via VeloCap, so this is pure noise reduction.
const MEDIA_HOST_DENYLIST = /(\.googlevideo\.com|\.youtube\.com\/(api\/stats|videoplayback)|\.ytimg\.com\/sb\/|\.vimeocdn\.com|\.cloudfront\.net\/.*\.m3u8|\.cloudfront\.net\/.*\.ts)/i;
function shouldSkipNetworkLogging(url: string): boolean {
  return MEDIA_HOST_DENYLIST.test(url);
}

// Whitelist by inversion — anything that's NOT known-binary is tried as
// text. This covers custom types like `application/vnd.xxx+json`,
// `application/ld+json`, `application/problem+json`, APIs that send no
// Content-Type at all, and SSE/ndjson streams.
const BINARY_CONTENT_TYPES =
  /^(image\/|video\/|audio\/|font\/|application\/(octet-stream|pdf|zip|gzip|x-tar|x-protobuf|wasm|vnd\.ms-|msword|x-bzip))/i;

function isTextualContentType(ct: string): boolean {
  if (!ct) return true; // unknown → try to read as text
  if (BINARY_CONTENT_TYPES.test(ct)) return false;
  return true;
}

function truncate(s: string, max = BODY_CAP): string {
  return s.length > max ? s.slice(0, max) + `…[truncated ${s.length - max}]` : s;
}

async function readRequestBody(init?: RequestInit | Request): Promise<string | undefined> {
  const body = (init as RequestInit | undefined)?.body;
  if (body == null) return undefined;
  try {
    if (typeof body === 'string') return truncate(body);
    if (body instanceof URLSearchParams) return truncate(body.toString());
    if (body instanceof FormData) {
      const parts: string[] = [];
      body.forEach((v, k) => parts.push(`${k}=${typeof v === 'string' ? v : `[file:${v instanceof File ? v.name : 'blob'}]`}`));
      return truncate(parts.join('&'));
    }
    if (body instanceof Blob) return `[blob ${body.type || 'unknown'} ${body.size}B]`;
    if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength}B]`;
  } catch {
    // fall through
  }
  return '[unreadable body]';
}

// Fix Issue 13: by default, NEVER read response bodies — that broke YouTube
// and other MSE-based streamers. Feature #12 follow-up: opt-in to read
// JSON / text bodies for HAR exports. The content script (isolated world)
// syncs the user's pref onto `document.documentElement.dataset.velocapBodies`
// since page-hook can't read chrome.storage from MAIN world.
const BODY_TEXTUAL = /^(application\/(json|x-www-form-urlencoded|ld\+json|problem\+json|xml|graphql)|text\/|application\/[a-z0-9.+-]+\+json)/i;
const RESPONSE_BODY_CAP = 250_000; // 250 KB per response — covers most real-world API payloads
const RESPONSE_BODY_HARD_SKIP = 5_000_000; // skip anything claiming > 5 MB

function bodyCaptureEnabled(): boolean {
  try {
    // Two channels: the content script sets BOTH. If a React app wipes the
    // <html> dataset, the window global survives. Either truthy = on.
    const ds = document.documentElement?.dataset?.velocapBodies === 'on';
    const win = (window as unknown as { __velocapBodies?: boolean }).__velocapBodies === true;
    return ds || win;
  } catch {
    return false;
  }
}

function summarizeResponse(res: Response): string | undefined {
  const ct = res.headers.get('content-type') || '';
  const len = res.headers.get('content-length');
  if (!ct && !len) return undefined;
  return len ? `[${ct || 'response'} ${len}B]` : `[${ct || 'response'}]`;
}

/**
 * Best-effort body read. Returns undefined if disabled, if the body is
 * binary/streaming/too-large, or if cloning fails. NEVER reads `res.body`
 * directly — always operates on a clone so the page's consumer is unaffected.
 *
 * Diagnostic logs use console.debug — surface in DevTools Console with the
 * "Verbose" level filter so they don't spam normal console output.
 */
async function safeReadResponseBody(res: Response): Promise<string | undefined> {
  if (!bodyCaptureEnabled()) {
    // eslint-disable-next-line no-console
    console.debug('[velocap/hook] body read skipped: flag off', res.url);
    return undefined;
  }
  const ct = res.headers.get('content-type') || '';
  if (!BODY_TEXTUAL.test(ct)) {
    // eslint-disable-next-line no-console
    console.debug('[velocap/hook] body read skipped: non-textual content-type', ct, res.url);
    return undefined;
  }
  // Skip absurdly large responses — but allow up to 5 MB to read since most
  // chatty JSON APIs return 50-500 KB and we want those.
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > 0 && len > RESPONSE_BODY_HARD_SKIP) {
    // eslint-disable-next-line no-console
    console.debug('[velocap/hook] body read skipped: too large', len, 'bytes', res.url);
    return undefined;
  }
  try {
    const text = await res.clone().text();
    // eslint-disable-next-line no-console
    console.debug('[velocap/hook] body captured:', text.length, 'chars', res.url);
    if (text.length > RESPONSE_BODY_CAP) {
      return text.slice(0, RESPONSE_BODY_CAP) + `…[truncated ${text.length - RESPONSE_BODY_CAP}]`;
    }
    return text;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('[velocap/hook] body read failed:', e, res.url);
    return undefined;
  }
}

const originalFetch = window.fetch;
window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Fast path: known-streaming media URLs are passed straight through with
  // no instrumentation. Cheapest possible behaviour for sites we know we'd
  // only get noise from.
  const reqUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input?.url ?? '';
  if (shouldSkipNetworkLogging(reqUrl)) {
    return originalFetch(input as RequestInfo, init);
  }
  const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  // Fix Issue 13 (real cause): previously this wrapper constructed
  // `new Request(input, init)` to read headers via `req.headers.forEach`.
  // `new Request(...)` *consumes* `init.body` when it's a ReadableStream
  // (and locks FormData with files), so the subsequent real `fetch(input,
  // init)` got an empty/locked body and failed → YouTube interpreted the
  // cascading failures as "You're offline."
  //
  // Now we read headers from sources we know are safe to inspect (init.headers
  // when init is provided, or input.headers when input is already a Request).
  // The original input/init are passed to fetch UNTOUCHED.
  const rawRequestHeaders: Record<string, string> = {};
  try {
    let h: Headers | undefined;
    if (init?.headers) {
      h = new Headers(init.headers);
    } else if (input instanceof Request) {
      h = input.headers;
    }
    h?.forEach((v, k) => (rawRequestHeaders[k] = v));
  } catch {
    // Header collection is best-effort. Never let it block the request.
  }
  const requestHeaders = sanitizeHeaders(rawRequestHeaders);
  // Request body capture. Expanded to cover every common shape:
  //   • string         → captured as-is, truncated
  //   • URLSearchParams → toString
  //   • FormData       → flatten to k=v pairs (files marked as "[file:name]")
  //   • Blob (small)   → text() if textual content-type AND ≤ 50KB
  //   • ArrayBuffer    → "[ArrayBuffer Nbytes]" marker only
  //   • ReadableStream → "[ReadableStream]" marker only (cannot read safely
  //                       — would lock the stream the page hasn't sent yet)
  let requestBody: string | undefined;
  const initBody = init?.body;
  if (initBody == null) {
    // no body — leave undefined
  } else if (typeof initBody === 'string') {
    requestBody = sanitizeBody(truncate(initBody));
  } else if (initBody instanceof URLSearchParams) {
    requestBody = sanitizeBody(truncate(initBody.toString()));
  } else if (typeof FormData !== 'undefined' && initBody instanceof FormData) {
    try {
      const parts: string[] = [];
      initBody.forEach((v, k) => {
        if (v instanceof File) parts.push(`${k}=[file:${v.name}:${v.size}B]`);
        else if (typeof Blob !== 'undefined' && v instanceof Blob) parts.push(`${k}=[blob:${v.type || 'unknown'}:${v.size}B]`);
        else parts.push(`${k}=${typeof v === 'string' ? v : '[object]'}`);
      });
      requestBody = sanitizeBody(truncate(parts.join('&')));
    } catch {
      requestBody = '[FormData]';
    }
  } else if (typeof Blob !== 'undefined' && initBody instanceof Blob) {
    // Small textual Blobs are safe to read off a clone. Use the textual
    // detector we already use for responses.
    if (initBody.size <= 50_000 && BODY_TEXTUAL.test(initBody.type || '')) {
      // We don't actually await this — keeping the fetch synchronous. Mark
      // with a placeholder and queue an async read that posts a bodyUpdate
      // for the request side too (matches the response-body pattern).
      requestBody = `[blob:${initBody.type || 'unknown'}:${initBody.size}B reading…]`;
      void initBody.text().then((text) => {
        post('network-end', {
          id,
          requestBody: sanitizeBody(truncate(text)),
          bodyUpdate: true,
        });
      }).catch(() => undefined);
    } else {
      requestBody = `[blob:${initBody.type || 'unknown'}:${initBody.size}B]`;
    }
  } else if (typeof ArrayBuffer !== 'undefined' && initBody instanceof ArrayBuffer) {
    requestBody = `[ArrayBuffer:${initBody.byteLength}B]`;
  } else if (typeof ReadableStream !== 'undefined' && initBody instanceof ReadableStream) {
    requestBody = '[ReadableStream]';
  } else {
    requestBody = `[${(initBody as Blob).constructor?.name ?? 'body'}]`;
  }
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  post('network-start', {
    id,
    type: 'fetch',
    method,
    url: reqUrl,
    requestHeaders,
    requestBody,
    startedAt,
  });
  try {
    const res = await originalFetch(input as RequestInfo, init);
    const rawResponseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (rawResponseHeaders[k] = v));
    const responseHeaders = sanitizeHeaders(rawResponseHeaders);
    // Fix Issue 13: synchronous metadata-only summary. We never touch
    // `res.clone()`, `res.body`, or `.text()` — those break streaming
    // sites like YouTube. The returned response is handed straight to the
    // page's consumer untouched.
    //
    // We emit the network-end immediately with the size summary so the row
    // appears in the log without any added latency to the page's fetch chain.
    // If the user opted into body capture, we fire-and-forget a clone-read
    // and post an update; the content-script bridge merges by id.
    post('network-end', {
      id,
      status: res.status,
      statusText: res.statusText,
      responseHeaders,
      responseBody: sanitizeBody(summarizeResponse(res)),
      durationMs: Date.now() - startedAt,
    });
    void safeReadResponseBody(res).then((body) => {
      if (body == null) return;
      post('network-end', {
        id,
        responseBody: sanitizeBody(body),
        // Marker so the bridge knows this is an upgrade, not a duplicate.
        bodyUpdate: true,
      });
    });
    return res;
  } catch (e) {
    post('network-end', {
      id,
      status: null,
      durationMs: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
};

// ---- XHR ----
const OrigXHR = window.XMLHttpRequest;
function PatchedXHR(this: XMLHttpRequest) {
  const xhr = new OrigXHR();
  let id = '';
  let startedAt = 0;
  let method = 'GET';
  let url = '';
  const requestHeaders: Record<string, string> = {};

  let skip = false;
  const origOpen = xhr.open.bind(xhr);
  xhr.open = function (m: string, u: string | URL, ...rest: unknown[]) {
    method = m;
    url = typeof u === 'string' ? u : u.toString();
    // Fix Issue 13: same denylist as fetch — don't instrument streaming
    // media chunks. `skip` propagates to send/loadend handlers below.
    skip = shouldSkipNetworkLogging(url);
    if (!skip) {
      id = `x_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    // @ts-expect-error variadic passthrough
    return origOpen(m, u, ...rest);
  };

  const origSetHeader = xhr.setRequestHeader.bind(xhr);
  xhr.setRequestHeader = function (k: string, v: string) {
    requestHeaders[k] = v;
    origSetHeader(k, v);
  };

  const origSend = xhr.send.bind(xhr);
  xhr.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    if (skip) return origSend(body);
    startedAt = Date.now();
    // Synchronously stringify the request body before send — a single
    // effort, matches fetch's captured request body behavior.
    let requestBody: string | undefined;
    if (body != null) {
      try {
        if (typeof body === 'string') requestBody = truncate(body);
        else if (body instanceof URLSearchParams) requestBody = truncate(body.toString());
        else if (body instanceof FormData) {
          const parts: string[] = [];
          body.forEach((v, k) => parts.push(`${k}=${typeof v === 'string' ? v : '[file]'}`));
          requestBody = truncate(parts.join('&'));
        } else if (body instanceof Blob) requestBody = `[blob ${body.type || 'unknown'} ${body.size}B]`;
        else if (body instanceof ArrayBuffer) requestBody = `[ArrayBuffer ${body.byteLength}B]`;
      } catch {
        requestBody = '[unreadable body]';
      }
    }
    post('network-start', {
      id,
      type: 'xhr',
      method,
      url,
      requestHeaders: sanitizeHeaders(requestHeaders),
      requestBody: sanitizeBody(requestBody),
      startedAt,
    });
    xhr.addEventListener('loadend', () => {
      const responseHeaders: Record<string, string> = {};
      const raw = xhr.getAllResponseHeaders();
      raw.split(/\r?\n/).forEach((line) => {
        const [k, ...rest] = line.split(': ');
        if (k && rest.length) responseHeaders[k.toLowerCase()] = rest.join(': ');
      });
      // Fix Issue 13: NEVER touch xhr.responseText. On large binary or
      // streaming responses this is hot-path expensive AND on some pages
      // accessing it is enough to disturb the consumer (especially when
      // xhr.responseType wasn't set explicitly). Just summarize.
      const ct = responseHeaders['content-type'] || '';
      const len = responseHeaders['content-length'];
      const responseBody = ct || len
        ? len
          ? `[${ct || 'response'} ${len}B]`
          : `[${ct || 'response'}]`
        : undefined;
      post('network-end', {
        id,
        status: xhr.status || null,
        statusText: xhr.statusText,
        responseHeaders: sanitizeHeaders(responseHeaders),
        responseBody: sanitizeBody(responseBody),
        durationMs: Date.now() - startedAt,
      });
    });
    return origSend(body);
  };

  return xhr;
}
PatchedXHR.prototype = OrigXHR.prototype;
// @ts-expect-error replacing global
window.XMLHttpRequest = PatchedXHR;
