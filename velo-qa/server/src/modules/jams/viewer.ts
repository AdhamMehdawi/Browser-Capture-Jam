// Self-contained HTML viewer for Jam permalinks. Ships as a single string —
// no bundler, no CSR framework. Replaced by the Next.js dashboard in Phase 4;
// kept here so the extension's "open jam" link works end-to-end today.

import { loadEnv } from '../../env.js';

// ========================================================================
// Gallery — a tiny index page at / that lists every PUBLIC Jam with a
// thumbnail (for screenshots) and metadata. A full dashboard with workspace
// filtering, search, and auth is Phase 4; this keeps a casual browsing path
// available until then.
// ========================================================================
export function renderJamGallery(jams: Array<{
  id: string;
  type: string;
  title: string | null;
  pageUrl: string;
  pageTitle: string | null;
  createdAt: Date;
  durationMs: number | null;
  createdBy: { name: string | null; email: string };
  workspace: { name: string };
  _thumbnailAssetId: string | null;
  _thumbnailKind: string | null;
}>): string {
  const env = loadEnv();
  const esc = (s: string | null | undefined): string =>
    s == null
      ? ''
      : String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

  const fmtDuration = (ms: number | null): string => {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  };

  const fmtAgo = (d: Date): string => {
    const diff = Date.now() - d.getTime();
    const s = Math.round(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };

  const cards = jams
    .map((j) => {
      const title = esc(j.title || j.pageTitle || j.pageUrl || j.id);
      const url = `${env.PUBLIC_API_URL}/j/${j.id}`;
      const thumbSrc = j._thumbnailAssetId
        ? `${env.PUBLIC_API_URL}/jams/assets/${j._thumbnailAssetId}`
        : null;
      const playBadge =
        j.type === 'VIDEO'
          ? `<div class="badge video">▶ ${esc(fmtDuration(j.durationMs))}</div>`
          : `<div class="badge shot">📸</div>`;
      let tileMedia: string;
      if (thumbSrc && j._thumbnailKind === 'video') {
        // Show video element for video thumbnails
        tileMedia = `<video class="thumb" src="${thumbSrc}" muted preload="metadata"></video>`;
      } else if (thumbSrc) {
        tileMedia = `<img class="thumb" src="${thumbSrc}" alt="${title}"/>`;
      } else {
        tileMedia = `<div class="thumb placeholder">${j.type === 'VIDEO' ? '▶' : '📸'}</div>`;
      }

      return `
        <a class="card" href="${url}">
          <div class="media">
            ${tileMedia}
            ${playBadge}
          </div>
          <div class="meta">
            <div class="title">${title}</div>
            <div class="sub">
              <span>${esc(j.workspace.name)}</span>
              <span>·</span>
              <span>${esc(fmtAgo(j.createdAt))}</span>
            </div>
          </div>
        </a>
      `;
    })
    .join('');

  const empty = `
    <div class="empty">
      <h2>No Jams yet</h2>
      <p>Open the Velo QA Chrome extension, hit <strong>Capture screenshot</strong> or <strong>Record this tab + mic</strong>, and your captures will show up here.</p>
    </div>
  `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VeloRec · Gallery</title>
  <style>
    :root { color-scheme: light dark; --bg:#0b0d12; --fg:#e6e9ef; --muted:#9aa3b2; --panel:#151922; --panel-border:#22283a; --accent:#ff4d7e; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid var(--panel-border); }
    .brand { font-weight:700; font-size:18px; letter-spacing:.2px; }
    .brand span { color: var(--accent); }
    .count { color: var(--muted); font-size: 13px; }
    main { padding: 20px 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .card {
      display: block; text-decoration: none; color: inherit;
      background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px;
      overflow: hidden; transition: border-color .15s, transform .15s;
    }
    .card:hover { border-color: var(--accent); transform: translateY(-2px); }
    .media { position: relative; aspect-ratio: 16/9; background: #000; overflow: hidden; }
    .thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb.placeholder { display: flex; align-items: center; justify-content: center; font-size: 36px; color: #3a4052; background: #0f131b; }
    .badge {
      position: absolute; right: 8px; bottom: 8px;
      padding: 3px 8px; border-radius: 4px;
      background: rgba(0,0,0,.7); color: #fff; font-size: 11px; font-weight: 600;
      backdrop-filter: blur(6px);
    }
    .badge.video { color: #ff4d7e; }
    .meta { padding: 10px 12px 12px; }
    .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { color: var(--muted); font-size: 12px; margin-top: 4px; display:flex; gap:6px; }
    .empty { text-align: center; padding: 80px 20px; color: var(--muted); }
    .empty h2 { color: var(--fg); margin: 0 0 8px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">Velo<span>Rec</span></div>
    <div class="count">${jams.length} ${jams.length === 1 ? 'jam' : 'jams'}</div>
  </header>
  <main>
    ${jams.length ? `<div class="grid">${cards}</div>` : empty}
  </main>
</body>
</html>`;
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely embed JSON inside a <script type="application/json"> block.
 *
 * Script contents aren't parsed as HTML, so we must NOT HTML-escape (that
 * would break JSON.parse on the client). We only have to neutralize the
 * one sequence that can break out of the tag: `</`. Escaping `<` to its
 * JSON unicode form also covers `<!--` and `<!` injection paths.
 */
function embedJson(v: unknown): string {
  return JSON.stringify(v ?? null).replace(/</g, '\\u003c');
}

export function renderJamHtml(jam: {
  id: string;
  type: string;
  title: string | null;
  pageUrl: string;
  pageTitle: string | null;
  createdAt: Date;
  device: unknown;
  console: unknown;
  network: unknown;
  createdBy: { name: string | null; email: string };
  workspace: { name: string };
  assets: Array<{ id: string; kind: string; contentType: string }>;
}): string {
  const env = loadEnv();
  const screenshot = jam.assets.find((a) => a.kind === 'screenshot');
  const video = jam.assets.find((a) => a.kind === 'video');
  const mediaHtml = video
    ? `<video controls src="${env.PUBLIC_API_URL}/jams/assets/${video.id}" style="max-width:100%;max-height:70vh;border-radius:8px;background:#000"></video>`
    : screenshot
      ? `<img src="${env.PUBLIC_API_URL}/jams/assets/${screenshot.id}" alt="screenshot" style="max-width:100%;max-height:70vh;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.15);background:#fff"/>`
      : `<div style="padding:48px;text-align:center;color:#888">No media</div>`;

  const title = esc(jam.title || jam.pageTitle || jam.pageUrl);
  const created = new Date(jam.createdAt).toLocaleString();
  const author = esc(jam.createdBy.name || jam.createdBy.email);

  const consoleJson = embedJson(jam.console);
  const networkJson = embedJson(jam.network);
  const deviceJson = embedJson(jam.device);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Velo QA</title>
  <style>
    :root { color-scheme: light dark; --bg:#0b0d12; --fg:#e6e9ef; --muted:#9aa3b2; --panel:#151922; --panel-border:#22283a; --accent:#ff4d7e; --error:#ff6b6b; --warn:#ffb84d; --info:#4db8ff; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--panel-border); }
    .brand { font-weight: 700; letter-spacing: 0.2px; }
    .brand span { color: var(--accent); }
    .meta { color: var(--muted); font-size: 12px; }
    main { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; padding: 16px 20px; min-height: calc(100vh - 60px); }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
    .panel { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
    .panel-header { padding: 10px 14px; border-bottom: 1px solid var(--panel-border); font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .panel-body { padding: 14px; overflow: auto; }
    .tabs { display: flex; border-bottom: 1px solid var(--panel-border); }
    .tabs button { flex: 1; background: transparent; color: var(--muted); border: 0; padding: 12px; cursor: pointer; font-size: 13px; font-weight: 500; border-bottom: 2px solid transparent; }
    .tabs button.active { color: var(--fg); border-bottom-color: var(--accent); }
    .tab-body { flex: 1; overflow: auto; padding: 12px 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
    .log { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); display: grid; grid-template-columns: 56px 1fr; gap: 10px; align-items: start; }
    .log .lvl { font-weight: 700; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; }
    .log .msg { white-space: pre-wrap; word-break: break-word; }
    .log.error .lvl { color: var(--error); }
    .log.warn  .lvl { color: var(--warn); }
    .log.info  .lvl { color: var(--info); }
    .log.log   .lvl { color: var(--muted); }
    .log.debug .lvl { color: var(--muted); opacity: .7; }
    .row { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.04); display: grid; grid-template-columns: 40px 1fr 60px 70px; gap: 10px; align-items: center; font-size: 12.5px; }
    .status-2 { color: #6bdd8f; }
    .status-3 { color: var(--info); }
    .status-4, .status-5 { color: var(--error); }
    .muted { color: var(--muted); }
    .kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 14px; padding: 12px; }
    .kv dt { color: var(--muted); }
    .kv dd { margin: 0; }
    .empty { padding: 24px; color: var(--muted); text-align: center; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
    a { color: var(--info); }
    .url { color: var(--muted); word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="brand">Velo<span>Rec</span></div>
      <div class="meta">${author} · ${esc(jam.workspace.name)} · ${created}</div>
    </div>
    <div class="meta">id: <code>${esc(jam.id)}</code></div>
  </header>
  <main>
    <section class="panel">
      <div class="panel-header">Capture</div>
      <div class="panel-body">
        ${mediaHtml}
        <div class="meta" style="margin-top:12px">
          <div><strong>${title}</strong></div>
          <div class="url"><a href="${esc(jam.pageUrl)}" target="_blank" rel="noreferrer">${esc(jam.pageUrl)}</a></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="tabs" role="tablist">
        <button class="active" data-tab="console">Console</button>
        <button data-tab="network">Network</button>
        <button data-tab="device">Device</button>
      </div>
      <div class="tab-body" id="tab-console"></div>
      <div class="tab-body" id="tab-network" hidden></div>
      <div class="tab-body" id="tab-device" hidden></div>
    </section>
  </main>
  <script id="jam-console" type="application/json">${consoleJson}</script>
  <script id="jam-network" type="application/json">${networkJson}</script>
  <script id="jam-device"  type="application/json">${deviceJson}</script>
  <script>
    (function(){
      const $ = (id) => document.getElementById(id);
      const read = (id) => JSON.parse($(id).textContent || 'null');
      const consoleLogs = read('jam-console') || [];
      const network = read('jam-network') || [];
      const device = read('jam-device') || {};

      function renderConsole() {
        const host = $('tab-console');
        if (!consoleLogs.length) { host.innerHTML = '<div class="empty">No console entries</div>'; return; }
        host.innerHTML = consoleLogs.map(l => {
          const lvl = (l.level || 'log').toLowerCase();
          const t = new Date(l.timestamp).toISOString().slice(11,23);
          const msg = (l.message || '') + (l.stack ? '\\n' + l.stack : '');
          return '<div class="log ' + lvl + '"><span class="lvl">' + lvl + '</span><pre class="msg">' + t + '  ' + escapeHtml(msg) + '</pre></div>';
        }).join('');
      }
      function renderNetwork() {
        const host = $('tab-network');
        if (!network.length) { host.innerHTML = '<div class="empty">No network captured</div>'; return; }
        host.innerHTML =
          '<div class="row muted"><div>#</div><div>URL</div><div>Status</div><div>Time</div></div>' +
          network.map((r,i) => {
            const st = r.status == null ? '-' : String(r.status);
            const cls = r.status == null ? 'muted' : ('status-' + String(r.status).charAt(0));
            const dur = r.durationMs ? Math.round(r.durationMs) + 'ms' : '-';
            return '<div class="row"><div class="muted">' + (i+1) + '</div>' +
                   '<div><code>' + escapeHtml(r.method || 'GET') + '</code> ' + escapeHtml(r.url || '') + '</div>' +
                   '<div class="' + cls + '">' + st + '</div><div class="muted">' + dur + '</div></div>';
          }).join('');
      }
      function renderDevice() {
        const host = $('tab-device');
        const d = device;
        host.innerHTML =
          '<dl class="kv">' +
          kv('User Agent', d.userAgent) +
          kv('Platform',  d.platform) +
          kv('Language',  d.language) +
          kv('Timezone',  d.timezone) +
          kv('Screen',    d.screen ? (d.screen.width + '×' + d.screen.height + ' @ ' + d.screen.dpr + 'x') : null) +
          kv('Viewport',  d.viewport ? (d.viewport.width + '×' + d.viewport.height) : null) +
          kv('Color',     d.colorScheme) +
          '</dl>';
      }
      function kv(k, v){ if (v == null || v === '') return ''; return '<dt>'+escapeHtml(k)+'</dt><dd>'+escapeHtml(String(v))+'</dd>'; }
      function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

      renderConsole(); renderNetwork(); renderDevice();

      document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        ['console','network','device'].forEach(t => { $('tab-' + t).hidden = (t !== b.dataset.tab); });
      }));
    })();
  </script>
</body>
</html>`;
}
