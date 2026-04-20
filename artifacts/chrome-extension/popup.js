// SnapCap popup controller

let mediaRecorder = null;
let recordedChunks = [];
let timerInterval = null;
let statsInterval = null;
let recordingTabId = null;
let recordingStartTime = null;
let currentRecordingId = null;

// ---- State sections ----
const sections = {
  connect: null,
  idle: null,
  recording: null,
  saved: null,
};

function $(id) { return document.getElementById(id); }

function showSection(name) {
  Object.entries(sections).forEach(([key, el]) => {
    if (el) el.classList.toggle('hidden', key !== name);
  });
}

function setStatus(text, type = 'idle') {
  const badge = $('statusBadge');
  const statusText = $('statusText');
  if (statusText) statusText.textContent = text;
  if (badge) badge.className = `status-badge status-badge--${type}`;
}

function showError(msg) {
  const bar = $('errorBar');
  const el = $('errorMsg');
  if (el) el.textContent = msg;
  if (bar) bar.classList.remove('hidden');
  setTimeout(() => { if (bar) bar.classList.add('hidden'); }, 4000);
}

// ---- First-run connect flow ----
// The extension can't do Clerk OAuth cleanly from a Chromium popup, so
// "login" here means: open the dashboard in a real tab, sign in, copy the
// API key from Dashboard → Settings, and paste it back. This card makes
// that the front-and-centre experience until an API key is saved.
function initConnect() {
  const openBtn = document.getElementById('btnOpenDashboard');
  const connectBtn = document.getElementById('btnConnect');
  const skipBtn = document.getElementById('btnSkipConnect');
  const statusEl = document.getElementById('connectStatus');
  const apiInput = document.getElementById('apiKeyInputConnect');
  const urlInput = document.getElementById('serverUrlInputConnect');
  if (!openBtn || !connectBtn) return;

  openBtn.addEventListener('click', () => {
    const url = (urlInput?.value || '').trim() || 'https://your-app.replit.app';
    chrome.tabs.create({ url });
  });

  connectBtn.addEventListener('click', async () => {
    const apiKey = (apiInput?.value || '').trim();
    const serverUrl = (urlInput?.value || '').trim();
    if (!apiKey || !serverUrl) {
      if (statusEl) statusEl.textContent = 'Enter both API key and server URL.';
      return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = 'Verifying…';
    // Ping /api/user/me to validate the key. If the backend auth accepts
    // API-key-as-Bearer, great — otherwise we still save it so the user
    // can try sync later without re-entering.
    let ok = false;
    try {
      const res = await fetch(serverUrl.replace(/\/$/, '') + '/api/user/me', {
        headers: { Authorization: 'Bearer ' + apiKey },
      });
      ok = res.ok;
    } catch (e) {}
    await new Promise((r) => chrome.storage.sync.set({ apiKey, serverUrl }, r));
    if (statusEl) statusEl.textContent = ok ? 'Connected.' : 'Saved (couldn\'t verify — sync will try anyway).';
    showSection('idle');
    refreshConnectedHint();
    connectBtn.textContent = 'Connect';
    connectBtn.disabled = false;
  });

  skipBtn?.addEventListener('click', () => {
    showSection('idle');
  });
}

async function refreshConnectedHint() {
  const hint = document.getElementById('connectedHint');
  if (!hint) return;
  const data = await new Promise((r) => chrome.storage.sync.get(['apiKey', 'serverUrl'], r));
  if (data.apiKey && data.serverUrl) {
    try {
      const host = new URL(data.serverUrl).host;
      hint.textContent = 'Connected to ' + host + ' — recordings can be synced to your dashboard.';
    } catch {
      hint.textContent = 'Connected — recordings can be synced.';
    }
  } else {
    hint.textContent = 'Capture your screen and all network activity in one click.';
  }
}

// ---- Settings ----
function initSettings() {
  const btn = $('btnSettings');
  const panel = $('settingsPanel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
  });

  $('btnSaveSettings').addEventListener('click', () => {
    const apiKey = $('apiKeyInput').value.trim();
    const serverUrl = $('serverUrlInput').value.trim();
    chrome.storage.sync.set({ apiKey, serverUrl }, () => {
      const s = $('settingsSyncStatus');
      if (s) { s.textContent = 'Saved.'; setTimeout(() => { s.textContent = ''; }, 2000); }
    });
  });

  chrome.storage.sync.get(['apiKey', 'serverUrl'], (data) => {
    if ($('apiKeyInput')) $('apiKeyInput').value = data.apiKey || '';
    if ($('serverUrlInput')) $('serverUrlInput').value = data.serverUrl || '';
  });
}

// ---- Recording ----
async function startRecording() {
  try {
    showError('');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    recordingTabId = tab.id;

    await chrome.runtime.sendMessage({ action: 'START_RECORDING', tabId: recordingTabId });

    const captureMic = $('captureMic')?.checked || false;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { mediaSource: 'tab' },
      audio: captureMic ? true : false,
    });

    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => { stream.getTracks().forEach((t) => t.stop()); finishRecording(); };
    mediaRecorder.start(1000);

    // Start timer
    recordingStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      const el = $('recordingTimer');
      if (el) el.textContent = `${m}:${s}`;
    }, 500);

    // Live stats polling
    statsInterval = setInterval(async () => {
      try {
        const res = await chrome.runtime.sendMessage({ action: 'GET_STATE', tabId: recordingTabId });
        const logsRes = await chrome.runtime.sendMessage({ action: 'GET_NETWORK_LOGS', tabId: recordingTabId });
        const logs = logsRes?.logs || [];
        const requests = logs.filter((e) => e.type === 'request').length;
        const errors = logs.filter(
          (e) => (e.type === 'request' && (e.error || (e.status && e.status >= 400))) ||
                 (e.type === 'console' && e.level === 'error')
        ).length;
        const consoles = logs.filter((e) => e.type === 'console').length;
        if ($('networkCount')) $('networkCount').textContent = requests;
        if ($('errorCount')) $('errorCount').textContent = errors;
        if ($('consoleCount')) $('consoleCount').textContent = consoles;
      } catch (e) {}
    }, 1000);

    showSection('recording');
    setStatus('Recording', 'recording');
  } catch (err) {
    if (err.name !== 'NotAllowedError') showError(`Error: ${err.message}`);
    else setStatus('Ready');
    chrome.runtime.sendMessage({ action: 'CLEAR_RECORDING', tabId: recordingTabId });
  }
}

async function stopRecording() {
  clearInterval(timerInterval);
  clearInterval(statsInterval);
  setStatus('Saving…');
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    finishRecording();
  }
}

async function finishRecording() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = recordingTabId || tab.id;

    const bgRes = await chrome.runtime.sendMessage({ action: 'STOP_RECORDING', tabId });
    const networkLogs = bgRes?.networkLogs || [];

    let videoDataUrl = null;
    if (recordedChunks.length > 0) {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      videoDataUrl = await blobToDataUrl(blob);
    }

    const duration = recordingStartTime ? Date.now() - recordingStartTime : 0;
    const recId = generateId();
    currentRecordingId = recId;

    const recording = {
      id: recId,
      title: `${tab.title || 'Recording'} — ${formatDateTime(new Date())}`,
      pageUrl: tab.url || null,
      pageTitle: tab.title || null,
      duration,
      networkLogs,
      videoDataUrl,
      tags: [],
      createdAt: Date.now(),
      browserInfo: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
      },
    };

    await chrome.storage.local.set({ [`recording-${recId}`]: recording });
    const idxRes = await chrome.storage.local.get(['recordingIds']);
    const ids = idxRes.recordingIds || [];
    ids.unshift(recId);
    await chrome.storage.local.set({ recordingIds: ids });

    // Update saved panel
    const secs = Math.round(duration / 1000);
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    if ($('savedDuration')) $('savedDuration').textContent = `${m}:${s}`;
    const reqCount = networkLogs.filter((e) => e.type === 'request').length;
    if ($('savedRequests')) $('savedRequests').textContent = `${reqCount} requests`;

    showSection('saved');
    setStatus('Saved');
    recordedChunks = [];
  } catch (err) {
    showError(`Save error: ${err.message}`);
    showSection('idle');
    setStatus('Ready');
  }
}

// ---- Saved actions ----
async function viewRecording() {
  if (!currentRecordingId) return;
  const url = chrome.runtime.getURL(`viewer.html?id=${currentRecordingId}`);
  chrome.tabs.create({ url });
}

async function downloadRecording() {
  if (!currentRecordingId) return;
  const stored = await chrome.storage.local.get([`recording-${currentRecordingId}`]);
  const rec = stored[`recording-${currentRecordingId}`];
  if (!rec) return;
  const exportData = { ...rec, videoDataUrl: undefined };
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snapcap-${currentRecordingId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function syncToDashboard() {
  if (!currentRecordingId) return;

  const settings = await new Promise((r) => chrome.storage.sync.get(['apiKey', 'serverUrl'], r));
  if (!settings.apiKey) {
    const s = $('syncStatus');
    if (s) { s.textContent = 'Add API key in settings first.'; setTimeout(() => { s.textContent = ''; }, 3000); }
    return;
  }

  const btn = $('btnSyncToDashboard');
  if (btn) { btn.textContent = 'Syncing…'; btn.disabled = true; }

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'SYNC_TO_BACKEND',
      recordingId: `recording-${currentRecordingId}`,
      apiKey: settings.apiKey,
      serverUrl: settings.serverUrl,
    });

    const s = $('syncStatus');
    if (result.success) {
      if (btn) btn.textContent = 'Synced';
      if (s) { s.textContent = 'Uploaded to dashboard.'; setTimeout(() => { s.textContent = ''; }, 4000); }
    } else {
      if (btn) { btn.textContent = 'Sync to Dashboard'; btn.disabled = false; }
      if (s) { s.textContent = `Failed: ${result.error}`; setTimeout(() => { s.textContent = ''; }, 4000); }
    }
  } catch (err) {
    if (btn) { btn.textContent = 'Sync to Dashboard'; btn.disabled = false; }
    showError(`Sync error: ${err.message}`);
  }
}

function newRecording() {
  showSection('idle');
  setStatus('Ready');
  currentRecordingId = null;
}

// ---- Utilities ----
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(date) {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  sections.connect = $('mainConnect');
  sections.idle = $('mainIdle');
  sections.recording = $('mainRecording');
  sections.saved = $('mainSaved');

  initSettings();
  initConnect();

  $('btnRecord')?.addEventListener('click', startRecording);
  $('btnStop')?.addEventListener('click', stopRecording);
  $('btnView')?.addEventListener('click', viewRecording);
  $('btnDownload')?.addEventListener('click', downloadRecording);
  $('btnSyncToDashboard')?.addEventListener('click', syncToDashboard);
  $('btnNew')?.addEventListener('click', newRecording);

  // React to the in-page overlay's Stop button.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'OVERLAY_STOP_REQUESTED') {
      stopRecording();
    }
  });

  await refreshConnectedHint();

  // Check if already recording; otherwise decide between Connect (first run)
  // and Idle (configured).
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.runtime.sendMessage({ action: 'GET_STATE', tabId: tab.id });
    if (res?.isRecording) {
      recordingTabId = tab.id;
      recordingStartTime = Date.now() - (res.elapsed || 0);
      showSection('recording');
      setStatus('Recording', 'recording');
      timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        const el = $('recordingTimer');
        if (el) el.textContent = `${m}:${s}`;
      }, 500);
    } else {
      const cfg = await new Promise((r) => chrome.storage.sync.get(['apiKey', 'serverUrl'], r));
      if (!cfg.apiKey || !cfg.serverUrl) {
        // First run — prompt the user to connect before anything else.
        showSection('connect');
        setStatus('Not connected');
      } else {
        showSection('idle');
        setStatus('Ready');
      }
    }
  } catch (e) {
    showSection('idle');
    setStatus('Ready');
  }
});
