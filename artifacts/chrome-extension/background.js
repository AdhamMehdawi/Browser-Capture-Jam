// Background service worker for SnapCap
// Handles network interception, interaction events, and backend sync

const networkLogs = new Map(); // tabId -> array of events
const recordingState = new Map(); // tabId -> { isRecording, startTime }
const pendingRequests = new Map(); // requestId -> { tabId, entry }

// ---- Network interception ----
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

    if (details.requestBody) {
      if (details.requestBody.raw) {
        try {
          const bytes = new Uint8Array(
            details.requestBody.raw.reduce((acc, chunk) => acc.concat(Array.from(chunk.bytes || [])), [])
          );
          entry.requestBody = new TextDecoder().decode(bytes).substring(0, 2000);
        } catch (e) {
          entry.requestBody = '[binary data]';
        }
      } else if (details.requestBody.formData) {
        entry.requestBody = JSON.stringify(details.requestBody.formData);
      }
    }

    pendingRequests.set(details.requestId, { tabId: details.tabId, entry });
    addEvent(details.tabId, entry);
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const pending = pendingRequests.get(details.requestId);
    if (pending && details.requestHeaders) {
      const headers = details.requestHeaders.reduce((acc, h) => {
        acc[h.name] = h.value;
        return acc;
      }, {});
      pending.entry.requestHeaders = headers;
      updateEvent(details.tabId, details.requestId, { requestHeaders: headers });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const headers = details.responseHeaders
      ? details.responseHeaders.reduce((acc, h) => { acc[h.name] = h.value; return acc; }, {})
      : {};
    updateEvent(details.tabId, details.requestId, {
      status: details.statusCode,
      statusLine: details.statusLine,
      responseHeaders: headers,
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
    updateEvent(details.tabId, details.requestId, { status: details.statusCode, duration, completed: true });
    pendingRequests.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!isRecordingTab(details.tabId)) return;
    const pending = pendingRequests.get(details.requestId);
    const duration = pending ? Date.now() - pending.entry.timestamp : null;
    updateEvent(details.tabId, details.requestId, { error: details.error, duration, completed: true });
    pendingRequests.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

function isRecordingTab(tabId) {
  return recordingState.has(tabId) && recordingState.get(tabId).isRecording;
}

function addEvent(tabId, entry) {
  if (!networkLogs.has(tabId)) networkLogs.set(tabId, []);
  networkLogs.get(tabId).push(entry);
}

function updateEvent(tabId, requestId, updates) {
  if (!networkLogs.has(tabId)) return;
  const logs = networkLogs.get(tabId);
  const entry = logs.find((e) => e.id === requestId);
  if (entry) Object.assign(entry, updates);
}

// ---- Message handler ----
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
        addEvent(tabId, {
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

    case 'INTERACTION_EVENT': {
      if (isRecordingTab(tabId)) {
        addEvent(tabId, {
          id: `${message.eventType}-${Date.now()}-${Math.random()}`,
          type: message.eventType,
          timestamp: message.timestamp,
          ...message.data,
        });
      }
      sendResponse({ success: true });
      break;
    }

    case 'SYNC_TO_BACKEND': {
      syncToBackend(message.recordingId, message.apiKey, message.serverUrl)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      break;
    }

    default:
      sendResponse({ error: 'Unknown action' });
  }

  return true;
});

// ---- Backend sync ----
async function syncToBackend(recordingId, apiKey, serverUrl) {
  try {
    const stored = await chrome.storage.local.get([recordingId]);
    const data = stored[recordingId];
    if (!data) return { success: false, error: 'Recording not found in local storage' };

    const baseUrl = serverUrl || 'https://localhost';

    // Upload video if present
    let videoObjectPath = null;
    if (data.videoDataUrl) {
      const blob = dataUrlToBlob(data.videoDataUrl);
      const ext = data.videoDataUrl.startsWith('data:video/mp4') ? 'mp4' : 'webm';

      const urlRes = await fetch(`${baseUrl}/api/storage/uploads/request-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          name: `recording.${ext}`,
          size: blob.size,
          contentType: blob.type,
        }),
      });

      if (urlRes.ok) {
        const { uploadURL, objectPath } = await urlRes.json();
        const uploadRes = await fetch(uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': blob.type },
          body: blob,
        });
        if (uploadRes.ok) videoObjectPath = objectPath;
      }
    }

    // Create recording on backend
    const res = await fetch(`${baseUrl}/api/recordings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: data.title || `Recording ${new Date(data.createdAt).toLocaleString()}`,
        duration: data.duration,
        pageUrl: data.pageUrl || null,
        pageTitle: data.pageTitle || null,
        tags: data.tags || [],
        events: data.networkLogs || [],
        videoObjectPath,
        browserInfo: data.browserInfo || null,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }

    const recording = await res.json();
    return { success: true, recordingId: recording.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'video/webm';
  const byteString = atob(parts[1]);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---- Tab cleanup ----
chrome.tabs.onRemoved.addListener((tabId) => {
  networkLogs.delete(tabId);
  recordingState.delete(tabId);
});
