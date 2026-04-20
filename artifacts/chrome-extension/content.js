// Content script - runs in page context
// Intercepts console logs and XHR/fetch for richer capture

(function () {
  'use strict';

  // Capture console output
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
        }).join(' ').substring(0, 1000);
        
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

  // Capture unhandled errors
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

  // Capture unhandled promise rejections
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
})();
