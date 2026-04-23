// Preview page — opens in its own tab after a recording stops. Reads the
// blob from the background (where it's held in memory as the "pending
// preview"), plays it, and lets the user upload / download / discard.
//
// Running in extension-origin context means no page CSP applies, which
// fixes the "Preview playback failed" seen when the old in-page modal
// tried to play blob:/data: URLs on CSP-locked sites.

interface PreviewState {
  dataUrl: string;
  mimeType?: string;
  durationMs: number;
  bytes: number;
  note?: string;
}

const main = document.getElementById('main') as HTMLElement;
const metaEl = document.getElementById('meta') as HTMLElement;
const closeHeaderBtn = document.getElementById('close-header') as HTMLButtonElement;

// Close button in header - discards recording and closes
closeHeaderBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ kind: 'bg:preview-discard' });
  window.close();
});

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSize(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes > 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${bytes} B`;
}

function renderEmpty(message: string): void {
  main.innerHTML = `<div class="empty">${message}</div>`;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  // fetch works for data: URIs in extension origin.
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Fix MediaRecorder's "duration: Infinity" bug. WebMs produced by
 * MediaRecorder don't embed a Duration element in the EBML header, so
 * browsers report `video.duration === Infinity` — which disables
 * scrubbing and seeking in most players. Seeking to a very large time
 * forces Chrome to walk the file to the last cluster, at which point the
 * real duration becomes known and scrubbing works.
 */
function enableScrubbingFor(video: HTMLVideoElement): void {
  const fix = () => {
    if (video.duration === Infinity || Number.isNaN(video.duration)) {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.currentTime = 0;
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = 1e101;
    }
  };
  if (video.readyState >= 1) fix();
  else video.addEventListener('loadedmetadata', fix, { once: true });
}

function render(state: PreviewState): void {
  metaEl.textContent = `${fmtDuration(state.durationMs)} · ${fmtSize(state.bytes)}`;
  console.log('[veloqa/preview] rendering', {
    bytes: state.bytes,
    durationMs: state.durationMs,
    dataUrlLen: state.dataUrl?.length,
    mime: state.mimeType,
  });

  main.innerHTML = `
    <video id="video" controls autoplay playsinline></video>
    ${state.note ? `<div class="card" style="background:#3a2a1a;color:#ffb84d;font-size:13px;">${state.note}</div>` : ''}
    <div class="card">
      <div>
        <label for="title">Title (optional)</label>
        <input id="title" type="text" placeholder="e.g. Login button broken on Safari" />
      </div>
      <div class="row right">
        <button id="discard" class="danger">Discard</button>
        <button id="download">Download</button>
        <button id="upload" class="primary">Upload &amp; get link</button>
      </div>
      <div class="status" id="status"></div>
    </div>
  `;

  const video = document.getElementById('video') as HTMLVideoElement;
  enableScrubbingFor(video);
  void dataUrlToBlob(state.dataUrl)
    .then((blob) => {
      console.log('[veloqa/preview] blob ready', blob.size, blob.type);
      const objectUrl = URL.createObjectURL(blob);
      video.src = objectUrl;
      video.load();
      window.addEventListener('beforeunload', () => URL.revokeObjectURL(objectUrl));
    })
    .catch((e) => {
      console.error('[veloqa/preview] blob conversion failed', e);
      // Fall back to the raw data URL — less robust, but extension-origin
      // pages can usually play data: URLs.
      video.src = state.dataUrl;
      video.load();
    });
  video.addEventListener('error', () => {
    console.error('[veloqa/preview] video error', video.error);
    setStatus(
      `Video playback failed (${video.error?.message ?? 'unknown'}). Use Download to save the file.`,
      'err',
    );
  });

  const status = document.getElementById('status') as HTMLElement;
  const setStatus = (text: string, cls: 'ok' | 'err' | '' = '') => {
    status.textContent = text;
    status.className = 'status' + (cls ? ' ' + cls : '');
  };

  const titleInput = document.getElementById('title') as HTMLInputElement;
  const discardBtn = document.getElementById('discard') as HTMLButtonElement;
  const downloadBtn = document.getElementById('download') as HTMLButtonElement;
  const uploadBtn = document.getElementById('upload') as HTMLButtonElement;

  discardBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ kind: 'bg:preview-discard' });
    window.close();
  });

  downloadBtn.addEventListener('click', async () => {
    // Route through the background's chrome.downloads call — the direct
    // <a download> path in iframes can be blocked depending on the host
    // page's origin, and the background's download API always works
    // because it runs outside the iframe sandbox.
    setStatus('Preparing download…');
    const res = await chrome.runtime.sendMessage({ kind: 'bg:download-preview' });
    if (res?.ok) {
      setStatus('✓ Download started', 'ok');
    } else {
      // Fall back to the local blob-url download if chrome.downloads refuses.
      try {
        const blob = await dataUrlToBlob(state.dataUrl);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `veloqa-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus('✓ Download started (fallback)', 'ok');
      } catch (e) {
        setStatus(`Download failed: ${res?.message ?? (e instanceof Error ? e.message : String(e))}`, 'err');
      }
    }
  });

  uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;
    discardBtn.disabled = true;
    downloadBtn.disabled = true;
    setStatus('Uploading…');
    const res = await chrome.runtime.sendMessage({
      kind: 'bg:preview-upload',
      title: titleInput.value.trim() || undefined,
    });
    if (res?.ok) {
      // Copy URL to clipboard automatically
      try {
        await navigator.clipboard.writeText(res.url);
        setStatus('✓ Uploaded & copied to clipboard!', 'ok');
      } catch {
        setStatus('✓ Uploaded', 'ok');
      }

      // Update the buttons - hide old ones and show new actions
      uploadBtn.textContent = 'Open Jam';
      uploadBtn.disabled = false;
      uploadBtn.onclick = () => window.open(res.url, '_blank');

      discardBtn.textContent = 'Close';
      discardBtn.className = 'ghost';
      discardBtn.disabled = false;
      discardBtn.onclick = () => window.close();

      downloadBtn.textContent = 'Copy Link';
      downloadBtn.disabled = false;
      downloadBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(res.url);
          downloadBtn.textContent = '✓ Copied!';
          setTimeout(() => { downloadBtn.textContent = 'Copy Link'; }, 2000);
        } catch {
          setStatus('Failed to copy', 'err');
        }
      };
    } else {
      setStatus(res?.message || 'Upload failed', 'err');
      uploadBtn.disabled = false;
      discardBtn.disabled = false;
      downloadBtn.disabled = false;
    }
  });
}

// When running as an iframe inside a content-script modal, the `?embed=1`
// query param is set. In that mode, Close/Discard should tear down the
// parent modal (the iframe doesn't own its own tab).
const isEmbedded = new URLSearchParams(location.search).get('embed') === '1';

function closeOuter(): void {
  if (isEmbedded) {
    window.parent.postMessage({ tag: 'veloqa/preview', action: 'close' }, '*');
  } else {
    window.close();
  }
}

// Patch the two places that close the window so they respect embed mode.
const origClose = window.close.bind(window);
(window as unknown as { close: () => void }).close = () => {
  if (isEmbedded) closeOuter();
  else origClose();
};

void (async () => {
  const state = (await chrome.runtime.sendMessage({ kind: 'bg:get-pending-preview' })) as
    | PreviewState
    | { empty: true }
    | undefined;
  if (!state || (state as { empty?: boolean }).empty) {
    renderEmpty('Nothing to preview — the recording was already uploaded or discarded.');
    return;
  }
  render(state as PreviewState);
})();
