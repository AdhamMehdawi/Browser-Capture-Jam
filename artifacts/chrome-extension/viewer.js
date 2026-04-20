// Viewer page script for SnapCap
// Loads recording data from chrome.storage.local and renders it

const $ = (id) => document.getElementById(id);

let allLogs = [];
let filteredLogs = [];
let activeFilter = 'all';
let searchQuery = '';
let selectedIndex = null;
let recordingData = null;

// ---- Load data ----
async function loadRecording() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');

  if (!id) {
    showFallback('No recording ID provided.');
    return;
  }

  const result = await chrome.storage.local.get([id]);
  const data = result[id];

  if (!data) {
    showFallback('Recording not found. It may have been cleared.');
    return;
  }

  recordingData = data;
  allLogs = data.networkLogs || [];

  // Render meta
  const date = new Date(data.createdAt);
  $('recDate').textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  $('recDuration').textContent = formatTime(data.duration);

  // Render chips
  const requests = allLogs.filter((l) => l.type === 'request');
  const errors = allLogs.filter((l) => (l.type === 'request' && (l.error || l.status >= 400)) || (l.type === 'console' && l.level === 'error'));
  const consoleLogs = allLogs.filter((l) => l.type === 'console');
  $('chipTotal').textContent = `${allLogs.length} events`;
  $('chipRequests').textContent = `${requests.length} requests`;
  $('chipErrors').textContent = `${errors.length} errors`;
  $('chipConsole').textContent = `${consoleLogs.length} console`;

  // Load video
  if (data.videoDataUrl) {
    const video = $('videoPlayer');
    video.src = data.videoDataUrl;
    video.classList.add('loaded');
    $('noVideo').style.display = 'none';
  }

  applyFilters();
}

function showFallback(msg) {
  $('logList').innerHTML = `<div class="empty-state">${msg}</div>`;
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getStatusClass(status) {
  if (!status) return 'status-pending';
  if (status < 300) return 'status-ok';
  if (status < 400) return 'status-redirect';
  return 'status-error';
}

function isErrorLog(log) {
  if (log.type === 'request') return log.error || (log.status && log.status >= 400);
  if (log.type === 'console') return log.level === 'error';
  return false;
}

function applyFilters() {
  filteredLogs = allLogs.filter((log) => {
    // Filter tab
    if (activeFilter === 'request' && log.type !== 'request') return false;
    if (activeFilter === 'console' && log.type !== 'console') return false;
    if (activeFilter === 'error' && !isErrorLog(log)) return false;

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = [
        log.url || '',
        log.method || '',
        log.message || '',
        String(log.status || ''),
        log.level || '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  renderLogList();
}

function renderLogList() {
  const list = $('logList');
  if (filteredLogs.length === 0) {
    list.innerHTML = '<div class="empty-state">No matching logs.</div>';
    return;
  }

  list.innerHTML = filteredLogs.map((log, i) => {
    const isErr = isErrorLog(log);
    const rowClass = `log-row${isErr ? ' log-error' : ''}${i === selectedIndex ? ' selected' : ''}`;

    if (log.type === 'request') {
      const iconClass = isErr ? 'req-error' : 'req';
      const statusClass = getStatusClass(log.status);
      const shortUrl = log.url ? truncateUrl(log.url) : '(unknown)';

      return `
        <div class="${rowClass}" data-idx="${i}">
          <div class="log-type-icon ${iconClass}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="log-body">
            <div class="log-url">${escHtml(shortUrl)}</div>
            <div class="log-meta">
              ${log.method ? `<span class="log-method">${escHtml(log.method)}</span>` : ''}
              ${log.status ? `<span class="log-status ${statusClass}">${log.status}</span>` : log.error ? `<span class="log-status status-error">ERR</span>` : `<span class="log-status status-pending">—</span>`}
              <span class="log-time">${formatTs(log.timestamp)}</span>
              ${log.duration != null ? `<span class="log-duration">${formatDuration(log.duration)}</span>` : ''}
            </div>
          </div>
        </div>`;
    }

    if (log.type === 'console') {
      const lvl = log.level || 'log';
      const iconMap = {
        log: 'con-log', warn: 'con-warn', error: 'con-error',
        info: 'con-info', debug: 'con-log',
      };
      const iconClass = iconMap[lvl] || 'con-log';
      const iconSvg = lvl === 'error'
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>`
        : lvl === 'warn'
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" stroke-width="2"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>`
        : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><polyline points="4 17 10 11 4 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="19" x2="20" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

      return `
        <div class="${rowClass}" data-idx="${i}">
          <div class="log-type-icon ${iconClass}">${iconSvg}</div>
          <div class="log-body">
            <div class="log-url">${escHtml((log.message || '').substring(0, 100))}</div>
            <div class="log-meta">
              <span class="log-method" style="background:#f3f4f6;color:#6b7280;text-transform:capitalize">${escHtml(lvl)}</span>
              <span class="log-time">${formatTs(log.timestamp)}</span>
            </div>
          </div>
        </div>`;
    }

    return '';
  }).join('');

  // Attach click handlers
  list.querySelectorAll('.log-row').forEach((row) => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx, 10);
      selectLog(idx);
    });
  });
}

function selectLog(idx) {
  selectedIndex = idx;
  renderLogList();
  const log = filteredLogs[idx];
  renderDetail(log);
}

function renderDetail(log) {
  const panel = $('detailPanel');

  if (log.type === 'request') {
    panel.innerHTML = `
      <div class="detail-content">
        <div class="detail-title">${escHtml(log.url || '')}</div>

        <div class="detail-section">
          <div class="detail-section-label">General</div>
          <div class="detail-kv">
            ${kv('Method', log.method || '—')}
            ${kv('Status', log.status ? `${log.status} ${log.statusLine || ''}` : (log.error || 'Pending'))}
            ${kv('Type', log.resourceType || '—')}
            ${kv('Duration', log.duration != null ? formatDuration(log.duration) : '—')}
            ${kv('Time', formatTs(log.timestamp))}
            ${log.initiator ? kv('Initiator', log.initiator) : ''}
          </div>
        </div>

        ${log.requestHeaders ? `
        <div class="detail-section">
          <div class="detail-section-label">Request Headers</div>
          <div class="detail-kv">${Object.entries(log.requestHeaders).map(([k, v]) => kv(k, v)).join('')}</div>
        </div>` : ''}

        ${log.requestBody ? `
        <div class="detail-section">
          <div class="detail-section-label">Request Body</div>
          <pre class="detail-body">${escHtml(tryPrettyJson(log.requestBody))}</pre>
        </div>` : ''}

        ${log.responseHeaders ? `
        <div class="detail-section">
          <div class="detail-section-label">Response Headers</div>
          <div class="detail-kv">${Object.entries(log.responseHeaders).map(([k, v]) => kv(k, v)).join('')}</div>
        </div>` : ''}

        ${log.error ? `
        <div class="detail-section">
          <div class="detail-section-label">Error</div>
          <pre class="detail-body" style="color:#dc2626">${escHtml(log.error)}</pre>
        </div>` : ''}
      </div>
    `;
  } else if (log.type === 'console') {
    panel.innerHTML = `
      <div class="detail-content">
        <div class="detail-title">${escHtml((log.message || '').substring(0, 150))}</div>

        <div class="detail-section">
          <div class="detail-section-label">Info</div>
          <div class="detail-kv">
            ${kv('Level', log.level || 'log')}
            ${kv('Time', formatTs(log.timestamp))}
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-section-label">Message</div>
          <pre class="detail-body">${escHtml(log.message || '')}</pre>
        </div>

        ${log.stack ? `
        <div class="detail-section">
          <div class="detail-section-label">Stack Trace</div>
          <pre class="detail-body" style="color:#6b7280">${escHtml(log.stack)}</pre>
        </div>` : ''}
      </div>
    `;
  }
}

function kv(key, val) {
  return `<div class="detail-kv-row"><span class="kv-key">${escHtml(key)}</span><span class="kv-val">${escHtml(String(val || ''))}</span></div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    return u.hostname + (path.length > 50 ? path.substring(0, 50) + '…' : path);
  } catch (e) {
    return url.substring(0, 80);
  }
}

function tryPrettyJson(str) {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch (e) {
    return str;
  }
}

// ---- Events ----
document.querySelectorAll('.filter-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeFilter = tab.dataset.filter;
    selectedIndex = null;
    applyFilters();
  });
});

$('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  selectedIndex = null;
  applyFilters();
});

$('btnDownload').addEventListener('click', () => {
  if (!recordingData) return;

  // Download video
  if (recordingData.videoDataUrl) {
    const a = document.createElement('a');
    a.href = recordingData.videoDataUrl;
    const ext = recordingData.videoDataUrl.startsWith('data:video/mp4') ? 'mp4' : 'webm';
    a.download = `snapcap-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
    a.click();
  }

  // Download JSON logs
  const logJson = JSON.stringify({
    id: recordingData.id,
    createdAt: new Date(recordingData.createdAt).toISOString(),
    duration: recordingData.duration,
    networkLogs: recordingData.networkLogs,
  }, null, 2);

  const blob = new Blob([logJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snapcap-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

loadRecording();
