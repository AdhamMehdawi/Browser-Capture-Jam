// Background service worker for SnapCap
// Handles network request interception and recording state

const networkLogs = new Map(); // tabId -> array of network events
const recordingState = new Map(); // tabId -> { isRecording, startTime }
const pendingRequests = new Map(); // requestId -> { tabId, details }

// Listen for network requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    
    const entry = {
      id: details.requestId,
      type: 'request',
      method: details.method,
      url: details.url,
      resourceType: details.type,
      timestamp: Date.now(),
      requestBody: null,
      status: null,
      responseHeaders: null,
      duration: null,
      error: null,
      initiator: details.initiator || null,
    };

    // Capture request body if present
    if (details.requestBody) {
      if (details.requestBody.raw) {
        try {
          const bytes = new Uint8Array(details.requestBody.raw.reduce((acc, chunk) => acc.concat(Array.from(chunk.bytes || [])), []));
          entry.requestBody = new TextDecoder().decode(bytes).substring(0, 2000);
        } catch (e) {
          entry.requestBody = '[binary data]';
        }
      } else if (details.requestBody.formData) {
        entry.requestBody = JSON.stringify(details.requestBody.formData);
      }
    }

    pendingRequests.set(details.requestId, { tabId: details.tabId, entry });
    addNetworkLog(details.tabId, entry);
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const pending = pendingRequests.get(details.requestId);
    if (pending) {
      pending.entry.requestHeaders = details.requestHeaders ? 
        details.requestHeaders.reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {}) : {};
      updateNetworkLog(details.tabId, details.requestId, { requestHeaders: pending.entry.requestHeaders });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const headers = details.responseHeaders ? 
      details.responseHeaders.reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {}) : {};
    updateNetworkLog(details.tabId, details.requestId, { 
      status: details.statusCode, 
      statusLine: details.statusLine,
      responseHeaders: headers 
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const pending = pendingRequests.get(details.requestId);
    const duration = pending ? Date.now() - pending.entry.timestamp : null;
    updateNetworkLog(details.tabId, details.requestId, { 
      status: details.statusCode,
      duration,
      completed: true
    });
    pendingRequests.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const pending = pendingRequests.get(details.requestId);
    const duration = pending ? Date.now() - pending.entry.timestamp : null;
    updateNetworkLog(details.tabId, details.requestId, { 
      error: details.error,
      duration,
      completed: true
    });
    pendingRequests.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

function isRecordingTab(tabId) {
  return recordingState.has(tabId) && recordingState.get(tabId).isRecording;
}

function addNetworkLog(tabId, entry) {
  if (!networkLogs.has(tabId)) {
    networkLogs.set(tabId, []);
  }
  networkLogs.get(tabId).push(entry);
}

function updateNetworkLog(tabId, requestId, updates) {
  if (!networkLogs.has(tabId)) return;
  const logs = networkLogs.get(tabId);
  const entry = logs.find(e => e.id === requestId);
  if (entry) {
    Object.assign(entry, updates);
  }
}

// Message handler for popup/content script communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || (sender.tab && sender.tab.id);

  switch (message.action) {
    case 'START_RECORDING': {
      networkLogs.set(tabId, []);
      recordingState.set(tabId, { isRecording: true, startTime: Date.now() });
      sendResponse({ success: true });
      break;
    }

    case 'STOP_RECORDING': {
      if (recordingState.has(tabId)) {
        recordingState.get(tabId).isRecording = false;
      }
      const logs = networkLogs.get(tabId) || [];
      sendResponse({ success: true, networkLogs: logs });
      break;
    }

    case 'GET_STATE': {
      const state = recordingState.get(tabId) || { isRecording: false };
      const logs = networkLogs.get(tabId) || [];
      sendResponse({ isRecording: state.isRecording, logCount: logs.length });
      break;
    }

    case 'GET_NETWORK_LOGS': {
      const logs = networkLogs.get(tabId) || [];
      sendResponse({ logs });
      break;
    }

    case 'CLEAR_RECORDING': {
      networkLogs.delete(tabId);
      recordingState.delete(tabId);
      sendResponse({ success: true });
      break;
    }

    case 'CONSOLE_LOG': {
      if (isRecordingTab(tabId)) {
        addNetworkLog(tabId, {
          id: `console-${Date.now()}-${Math.random()}`,
          type: 'console',
          level: message.level,
          message: message.message,
          timestamp: message.timestamp,
          stack: message.stack || null,
        });
      }
      sendResponse({ success: true });
      break;
    }

    default:
      sendResponse({ error: 'Unknown action' });
  }

  return true; // Keep channel open for async response
});

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  networkLogs.delete(tabId);
  recordingState.delete(tabId);
});
