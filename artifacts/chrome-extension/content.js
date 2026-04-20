// Content script — runs in page context for each tab
// Captures console, DOM interactions, navigation, performance

(function () {
  'use strict';

  // ---- Console interception ----
  const originalConsole = {};
  const consoleLevels = ['log', 'warn', 'error', 'info', 'debug'];

  consoleLevels.forEach((level) => {
    originalConsole[level] = console[level].bind(console);
    console[level] = function (...args) {
      originalConsole[level](...args);
      try {
        const message = args.map(a => {
          try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
          catch (e) { return String(a); }
        }).join(' ').substring(0, 2000);

        let stack = null;
        if (level === 'error' || level === 'warn') {
          try { stack = new Error().stack; } catch (e) {}
        }

        chrome.runtime.sendMessage({
          action: 'CONSOLE_LOG',
          level,
          message,
          timestamp: Date.now(),
          stack,
        }).catch(() => {});
      } catch (e) {}
    };
  });

  // ---- Unhandled errors ----
  window.addEventListener('error', (event) => {
    try {
      chrome.runtime.sendMessage({
        action: 'CONSOLE_LOG',
        level: 'error',
        message: `[Unhandled Error] ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
        timestamp: Date.now(),
        stack: event.error ? event.error.stack : null,
      }).catch(() => {});
    } catch (e) {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      chrome.runtime.sendMessage({
        action: 'CONSOLE_LOG',
        level: 'error',
        message: `[Unhandled Promise Rejection] ${msg}`,
        timestamp: Date.now(),
        stack: reason instanceof Error ? reason.stack : null,
      }).catch(() => {});
    } catch (e) {}
  });

  // ---- Click tracking ----
  document.addEventListener('click', (event) => {
    try {
      const el = event.target;
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      const text = (el.textContent || '').trim().substring(0, 80);
      const id = el.id || '';
      const className = typeof el.className === 'string' ? el.className.substring(0, 80) : '';
      const href = el.href || el.closest('a')?.href || '';
      const role = el.getAttribute('role') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';

      chrome.runtime.sendMessage({
        action: 'INTERACTION_EVENT',
        eventType: 'click',
        data: {
          tag,
          text,
          id,
          className,
          href,
          role,
          ariaLabel,
          x: event.clientX,
          y: event.clientY,
          pageX: event.pageX,
          pageY: event.pageY,
        },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch (e) {}
  }, true);

  // ---- Navigation tracking ----
  const sendNavEvent = (url, title) => {
    try {
      chrome.runtime.sendMessage({
        action: 'INTERACTION_EVENT',
        eventType: 'navigation',
        data: { url, title },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch (e) {}
  };

  // Detect SPA navigations by overriding pushState/replaceState
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (state, title, url) {
    origPushState(state, title, url);
    sendNavEvent(String(url || location.href), document.title);
  };
  history.replaceState = function (state, title, url) {
    origReplaceState(state, title, url);
    sendNavEvent(String(url || location.href), document.title);
  };

  window.addEventListener('popstate', () => {
    sendNavEvent(location.href, document.title);
  });

  // ---- Performance metrics ----
  const sendPerformanceMetrics = () => {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return;

      const metrics = {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadTime: Math.round(nav.loadEventEnd - nav.startTime),
        ttfb: Math.round(nav.responseStart - nav.requestStart),
        transferSize: nav.transferSize,
        encodedBodySize: nav.encodedBodySize,
        decodedBodySize: nav.decodedBodySize,
        url: location.href,
        title: document.title,
      };

      chrome.runtime.sendMessage({
        action: 'INTERACTION_EVENT',
        eventType: 'performance',
        data: metrics,
        timestamp: Date.now(),
      }).catch(() => {});
    } catch (e) {}
  };

  // Send performance metrics after page load
  if (document.readyState === 'complete') {
    sendPerformanceMetrics();
  } else {
    window.addEventListener('load', () => setTimeout(sendPerformanceMetrics, 200));
  }

  // ---- Web Vitals (LCP, CLS, FID/INP) ----
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        let data = { metricName: entry.entryType };
        if (entry.entryType === 'largest-contentful-paint') {
          data = { ...data, value: Math.round(entry.startTime), element: entry.element?.tagName };
        } else if (entry.entryType === 'layout-shift') {
          if (!entry.hadRecentInput) {
            data = { ...data, value: entry.value };
          }
        } else if (entry.entryType === 'first-input') {
          data = { ...data, value: Math.round(entry.processingStart - entry.startTime) };
        }

        chrome.runtime.sendMessage({
          action: 'INTERACTION_EVENT',
          eventType: 'performance',
          data,
          timestamp: Date.now(),
        }).catch(() => {});
      }
    });

    observer.observe({ type: 'largest-contentful-paint', buffered: true });
    observer.observe({ type: 'layout-shift', buffered: true });
    observer.observe({ type: 'first-input', buffered: true });
  } catch (e) {}

  // ---- localStorage change tracking ----
  const origSetItem = localStorage.setItem.bind(localStorage);
  const origRemoveItem = localStorage.removeItem.bind(localStorage);
  const origClear = localStorage.clear.bind(localStorage);

  localStorage.setItem = function (key, value) {
    origSetItem(key, value);
    try {
      chrome.runtime.sendMessage({
        action: 'INTERACTION_EVENT',
        eventType: 'storage',
        data: { action: 'set', key, valueLength: String(value).length },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch (e) {}
  };

  localStorage.removeItem = function (key) {
    origRemoveItem(key);
    try {
      chrome.runtime.sendMessage({
        action: 'INTERACTION_EVENT',
        eventType: 'storage',
        data: { action: 'remove', key },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch (e) {}
  };

  localStorage.clear = function () {
    origClear();
    try {
      chrome.runtime.sendMessage({
        action: 'INTERACTION_EVENT',
        eventType: 'storage',
        data: { action: 'clear' },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch (e) {}
  };

  // ================================================================
  // Floating recording overlay
  //   A shadow-DOM pill pinned to the top of the page while recording,
  //   with a live timer and a Stop button. Driven by messages from the
  //   background service worker (SHOW_OVERLAY / HIDE_OVERLAY / TICK_OVERLAY).
  // ================================================================
  let overlayHost = null;
  let overlayTimerEl = null;
  let overlayStopBtn = null;
  let overlayStartedAt = 0;
  let overlayInterval = null;

  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return mm + ':' + String(ss).padStart(2, '0');
  }

  function showOverlay(startedAt) {
    if (overlayHost) return;
    overlayStartedAt = startedAt || Date.now();

    overlayHost = document.createElement('div');
    overlayHost.setAttribute('data-snapcap-overlay', '');
    overlayHost.style.cssText =
      'all: initial; position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;';

    const root = overlayHost.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host { all: initial; }' +
      '.bar { display: inline-flex; align-items: center; gap: 10px; padding: 8px 12px; background: #0b0d12; color: #e6e9ef; border: 1px solid #22283a; border-radius: 999px; font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,0.35); user-select: none; }' +
      '.brand { font-weight: 700; letter-spacing: .2px; } .brand b { color: #ff4d7e; }' +
      '.dot { width: 8px; height: 8px; border-radius: 50%; background: #ff4d7e; animation: pulse 1s infinite ease-in-out; }' +
      '.timer { font-variant-numeric: tabular-nums; color: #9aa3b2; min-width: 34px; text-align: center; }' +
      'button { background: #ff4d7e; color: #1a0914; border: 0; border-radius: 6px; padding: 6px 12px; font: inherit; font-weight: 600; cursor: pointer; }' +
      'button:disabled { background: #22283a; color: #9aa3b2; cursor: default; }' +
      'button:hover:not(:disabled) { filter: brightness(1.08); }' +
      '@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(1.5); } }' +
      '</style>' +
      '<div class="bar" role="status" aria-live="polite">' +
      '<span class="dot" aria-hidden="true"></span>' +
      '<span class="brand">Snap<b>Cap</b></span>' +
      '<span class="timer" id="t">0:00</span>' +
      '<button id="stop">Stop</button>' +
      '</div>';

    (document.documentElement || document.body).appendChild(overlayHost);
    overlayTimerEl = root.getElementById('t');
    overlayStopBtn = root.getElementById('stop');
    overlayStopBtn.addEventListener('click', () => {
      if (!overlayStopBtn) return;
      overlayStopBtn.disabled = true;
      overlayStopBtn.textContent = 'Saving…';
      try {
        chrome.runtime.sendMessage({ action: 'OVERLAY_STOP' }).catch(() => {});
      } catch (e) {}
    });

    const tick = () => {
      if (overlayTimerEl) overlayTimerEl.textContent = fmtElapsed(Date.now() - overlayStartedAt);
    };
    tick();
    overlayInterval = setInterval(tick, 500);
  }

  function hideOverlay() {
    if (overlayInterval != null) {
      clearInterval(overlayInterval);
      overlayInterval = null;
    }
    if (overlayHost) {
      overlayHost.remove();
      overlayHost = null;
      overlayTimerEl = null;
      overlayStopBtn = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return false;
    if (message.action === 'SHOW_OVERLAY') {
      showOverlay(message.startedAt);
      sendResponse({ ok: true });
      return false;
    }
    if (message.action === 'HIDE_OVERLAY') {
      hideOverlay();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();
