// Runs in the PAGE'S MAIN world. This is where console + fetch + XHR must
// be patched — the isolated-world content script can't see the page's global
// console. We forward events back to the content script via window.postMessage.

const TAG = 'veloqa/hook';

// Visible marker so users can confirm the hook installed.
// eslint-disable-next-line no-console
console.info('%c[Velo QA] page-hook installed', 'color:#ff4d7e;font-weight:bold');
(window as unknown as { __veloqa?: { hook: boolean } }).__veloqa = {
  ...((window as unknown as { __veloqa?: object }).__veloqa ?? {}),
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
  return !!el.closest?.('[data-veloqa-overlay], [data-veloqa-preview]');
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
document.addEventListener(
  'click',
  (e) => {
    const el = e.target as Element | null;
    if (!el || !(el instanceof Element)) return;
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
      const rendered = args.map((a) => safeStringify(a));
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
    message: e.message || 'Uncaught error',
    stack: e.error instanceof Error ? e.error.stack : undefined,
    timestamp: Date.now(),
    source: 'error',
  });
});

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  post('unhandledrejection', {
    level: 'error',
    message: `Unhandled rejection: ${safeStringify(reason)}`,
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: Date.now(),
    source: 'unhandledrejection',
  });
});

// ---- fetch ----
const BODY_CAP = 50_000; // chars — enough to debug most JSON / form payloads

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

async function readResponseBody(res: Response): Promise<string | undefined> {
  const ct = res.headers.get('content-type') || '';
  if (!isTextualContentType(ct)) {
    // Known binary — just note the size, never pull the bytes into memory.
    const len = res.headers.get('content-length');
    return len ? `[${ct || 'binary'} ${len}B]` : `[${ct || 'binary'}]`;
  }
  try {
    // Must clone — reading the body on the live response would drain it for
    // the page's own consumer and break the app we're recording.
    const text = await res.clone().text();
    if (!text) return undefined; // empty body — don't crowd the UI
    return truncate(text);
  } catch {
    return '[body not readable]';
  }
}

const originalFetch = window.fetch;
window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const req = new Request(input as RequestInfo, init);
  const requestHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => (requestHeaders[k] = v));
  const requestBody = await readRequestBody(init).catch(() => undefined);
  post('network-start', {
    id,
    type: 'fetch',
    method: req.method,
    url: req.url,
    requestHeaders,
    requestBody,
    startedAt,
  });
  try {
    const res = await originalFetch(input as RequestInfo, init);
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (responseHeaders[k] = v));
    // Read the response body off a clone — never touch the one returned to
    // the caller. Handle async read errors silently.
    readResponseBody(res).then((responseBody) => {
      post('network-end', {
        id,
        status: res.status,
        statusText: res.statusText,
        responseHeaders,
        responseBody,
        durationMs: Date.now() - startedAt,
      });
    }).catch(() => {
      post('network-end', {
        id,
        status: res.status,
        statusText: res.statusText,
        responseHeaders,
        durationMs: Date.now() - startedAt,
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

  const origOpen = xhr.open.bind(xhr);
  xhr.open = function (m: string, u: string | URL, ...rest: unknown[]) {
    method = m;
    url = typeof u === 'string' ? u : u.toString();
    id = `x_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      requestHeaders,
      requestBody,
      startedAt,
    });
    xhr.addEventListener('loadend', () => {
      const responseHeaders: Record<string, string> = {};
      const raw = xhr.getAllResponseHeaders();
      raw.split(/\r?\n/).forEach((line) => {
        const [k, ...rest] = line.split(': ');
        if (k && rest.length) responseHeaders[k.toLowerCase()] = rest.join(': ');
      });
      // Only read responseText for text-like response types to avoid
      // pulling binary into memory.
      let responseBody: string | undefined;
      try {
        if (!xhr.responseType || xhr.responseType === 'text' || xhr.responseType === 'json') {
          const t = xhr.responseText;
          if (t) responseBody = truncate(t);
        } else {
          responseBody = `[${xhr.responseType}]`;
        }
      } catch {
        // Some cross-origin XHRs throw on responseText access.
      }
      post('network-end', {
        id,
        status: xhr.status || null,
        statusText: xhr.statusText,
        responseHeaders,
        responseBody,
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
