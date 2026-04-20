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
})();
