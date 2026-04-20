// Runs in the PAGE'S MAIN world. This is where console + fetch + XHR must
// be patched — the isolated-world content script can't see the page's global
// console. We forward events back to the content script via window.postMessage.

const TAG = 'openjam/hook';

// Visible marker so users can confirm the hook installed.
// eslint-disable-next-line no-console
console.info('%c[OpenJam] page-hook installed', 'color:#ff4d7e;font-weight:bold');
(window as unknown as { __openjam?: { hook: boolean } }).__openjam = {
  ...((window as unknown as { __openjam?: object }).__openjam ?? {}),
  hook: true,
};

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
  post('network-start', {
    id,
    type: 'fetch',
    method: req.method,
    url: req.url,
    requestHeaders,
    startedAt,
  });
  try {
    const res = await originalFetch(input as RequestInfo, init);
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (responseHeaders[k] = v));
    post('network-end', {
      id,
      status: res.status,
      statusText: res.statusText,
      responseHeaders,
      durationMs: Date.now() - startedAt,
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
    post('network-start', {
      id,
      type: 'xhr',
      method,
      url,
      requestHeaders,
      startedAt,
    });
    xhr.addEventListener('loadend', () => {
      const responseHeaders: Record<string, string> = {};
      const raw = xhr.getAllResponseHeaders();
      raw.split(/\r?\n/).forEach((line) => {
        const [k, ...rest] = line.split(': ');
        if (k && rest.length) responseHeaders[k.toLowerCase()] = rest.join(': ');
      });
      post('network-end', {
        id,
        status: xhr.status || null,
        statusText: xhr.statusText,
        responseHeaders,
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
