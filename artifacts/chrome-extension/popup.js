// Popup script for SnapCap extension

let mediaRecorder = null;
let recordedChunks = [];
let timerInterval = null;
let statsInterval = null;
let startTime = null;
let currentTabId = null;
let savedData = null;

const $ = (id) => document.getElementById(id);

// State
let appState = 'idle'; // idle | recording | saved

function setView(view) {
  appState = view;
  $('mainIdle').classList.toggle('hidden', view !== 'idle');
  $('mainRecording').classList.toggle('hidden', view !== 'recording');
  $('mainSaved').classList.toggle('hidden', view !== 'saved');

  const badge = $('statusBadge');
  badge.className = 'status-badge';
  if (view === 'recording') {
    badge.classList.add('recording');
    $('statusText').textContent = 'Recording';
  } else if (view === 'saved') {
    badge.classList.add('saved');
    $('statusText').textContent = 'Saved';
  } else {
    $('statusText').textContent = 'Ready';
  }
}

function showError(msg) {
  const bar = $('errorBar');
  $('errorMsg').textContent = msg;
  bar.classList.remove('hidden');
  setTimeout(() => bar.classList.add('hidden'), 5000);
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function getCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => resolve(tab));
  });
}

async function startRecording() {
  try {
    const tab = await getCurrentTab();
    currentTabId = tab.id;

    const captureNetwork = $('captureNetwork').checked;
    const captureMic = $('captureMic').checked;

    // Request screen capture
    let stream;
    try {
      const videoConstraints = {
        video: {
          cursor: 'always',
          displaySurface: 'browser',
        },
        audio: captureMic,
      };
      stream = await navigator.mediaDevices.getDisplayMedia(videoConstraints);
    } catch (e) {
      showError('Screen capture was cancelled or denied.');
      return;
    }

    // Start network/console capturing in background
    if (captureNetwork) {
      await chrome.runtime.sendMessage({ action: 'START_RECORDING', tabId: currentTabId });
    }

    // Set up MediaRecorder
    recordedChunks = [];
    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};

    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      await finishRecording();
    };

    // Handle user stopping via browser's native stop button
    stream.getVideoTracks()[0].onended = () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    };

    mediaRecorder.start(1000); // Collect data every 1s
    startTime = Date.now();

    // Update UI
    setView('recording');
    startTimer();
    if (captureNetwork) startStatsUpdater();

  } catch (e) {
    showError(`Failed to start: ${e.message}`);
    console.error(e);
  }
}

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

function startTimer() {
  $('recordingTimer').textContent = '0:00';
  timerInterval = setInterval(() => {
    $('recordingTimer').textContent = formatTime(Date.now() - startTime);
  }, 500);
}

function startStatsUpdater() {
  statsInterval = setInterval(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'GET_NETWORK_LOGS', tabId: currentTabId });
      if (res && res.logs) {
        const network = res.logs.filter((l) => l.type === 'request');
        const errors = res.logs.filter((l) => (l.type === 'request' && (l.error || (l.status >= 400))) || (l.type === 'console' && l.level === 'error'));
        const consoleLogs = res.logs.filter((l) => l.type === 'console');
        $('networkCount').textContent = network.length;
        $('errorCount').textContent = errors.length;
        $('consoleCount').textContent = consoleLogs.length;
      }
    } catch (e) {}
  }, 1000);
}

async function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  clearInterval(timerInterval);
  clearInterval(statsInterval);
}

async function finishRecording() {
  const duration = Date.now() - startTime;

  // Fetch network logs
  let networkLogs = [];
  try {
    const res = await chrome.runtime.sendMessage({ action: 'STOP_RECORDING', tabId: currentTabId });
    if (res && res.networkLogs) networkLogs = res.networkLogs;
  } catch (e) {}

  // Build video blob
  const videoBlob = recordedChunks.length > 0
    ? new Blob(recordedChunks, { type: recordedChunks[0]?.type || 'video/webm' })
    : null;

  // Save to chrome.storage.local
  const recordingId = `rec-${Date.now()}`;
  const meta = {
    id: recordingId,
    createdAt: Date.now(),
    duration,
    networkLogs,
    requestCount: networkLogs.filter((l) => l.type === 'request').length,
    errorCount: networkLogs.filter((l) => l.type === 'request' && (l.error || l.status >= 400)).length,
    consoleCount: networkLogs.filter((l) => l.type === 'console').length,
  };

  // Store metadata + video as dataURL in storage
  if (videoBlob) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      meta.videoDataUrl = e.target.result;
      await chrome.storage.local.set({ [recordingId]: meta, lastRecordingId: recordingId });
      savedData = meta;
      showSaved(meta);
    };
    reader.readAsDataURL(videoBlob);
  } else {
    await chrome.storage.local.set({ [recordingId]: meta, lastRecordingId: recordingId });
    savedData = meta;
    showSaved(meta);
  }
}

function showSaved(meta) {
  $('savedDuration').textContent = formatTime(meta.duration);
  $('savedRequests').textContent = `${meta.requestCount} request${meta.requestCount !== 1 ? 's' : ''}`;
  setView('saved');
}

async function openViewer() {
  if (!savedData) return;
  const viewerUrl = chrome.runtime.getURL('viewer.html') + `?id=${savedData.id}`;
  chrome.tabs.create({ url: viewerUrl });
}

async function downloadRecording() {
  if (!savedData) return;

  // Download video
  if (savedData.videoDataUrl) {
    const a = document.createElement('a');
    a.href = savedData.videoDataUrl;
    const ext = savedData.videoDataUrl.startsWith('data:video/mp4') ? 'mp4' : 'webm';
    a.download = `snapcap-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
    a.click();
  }

  // Download network log as JSON
  const logJson = JSON.stringify({
    id: savedData.id,
    createdAt: new Date(savedData.createdAt).toISOString(),
    duration: savedData.duration,
    networkLogs: savedData.networkLogs,
  }, null, 2);

  const blob = new Blob([logJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snapcap-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Event listeners
$('btnRecord').addEventListener('click', startRecording);
$('btnStop').addEventListener('click', stopRecording);
$('btnView').addEventListener('click', openViewer);
$('btnDownload').addEventListener('click', downloadRecording);
$('btnNew').addEventListener('click', () => {
  savedData = null;
  setView('idle');
});

// Init: check if already recording
(async () => {
  try {
    const tab = await getCurrentTab();
    currentTabId = tab.id;
    const res = await chrome.runtime.sendMessage({ action: 'GET_STATE', tabId: tab.id });
    if (res && res.isRecording) {
      // Reconnect to existing recording state
      setView('recording');
      // Can't reconnect MediaRecorder across popup close, so show a message
      showError('A recording was in progress. It may have been interrupted when the popup closed. Click Stop to save what was captured.');
    }
  } catch (e) {}
  setView('idle');
})();
