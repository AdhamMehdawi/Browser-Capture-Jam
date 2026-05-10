// Preview page — opens in its own tab after a recording stops. Reads the
// video from IndexedDB (instant) or Azure SAS URL (fallback), and lets
// the user upload / download / discard.
//
// Running in extension-origin context means no page CSP applies, which
// fixes the "Preview playback failed" seen when the old in-page modal
// tried to play blob:/data: URLs on CSP-locked sites.

interface PreviewState {
  /** Read-only SAS URL for video/image playback from Azure */
  readSasUrl: string;
  /** Screenshot-only: data URL for local Fabric.js annotation */
  screenshotDataUrl?: string;
  mimeType?: string;
  mediaType?: 'video' | 'screenshot';
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
  console.log('[velocap/preview] rendering', {
    bytes: state.bytes,
    durationMs: state.durationMs,
    readSasUrl: state.readSasUrl ? '(present)' : '(missing)',
    mime: state.mimeType,
  });

  const durationMs = state.durationMs || 1;
  let trimStartMs = 0;
  let trimEndMs = durationMs;

  main.innerHTML = `
    <div class="player-wrap" id="player-wrap">
      <video id="video" controls autoplay playsinline></video>
    </div>
    <div class="trim-info" id="trim-info">
      <span class="trim-badge" id="trim-badge">✂ Full video</span>
    </div>
    <div class="card">
      <div>
        <label for="title">Title (optional)</label>
        <input id="title" type="text" placeholder="e.g. Login button broken on Safari" />
      </div>
      <div class="row right">
        <button id="discard" class="danger">Discard</button>
        <button id="download">Download</button>
        <button id="upload" class="primary">Upload</button>
      </div>
      <div class="status" id="status"></div>
    </div>
  `;

  // Inject integrated trim overlay styles
  if (!document.getElementById('trim-styles')) {
    const trimStyle = document.createElement('style');
    trimStyle.id = 'trim-styles';
    trimStyle.textContent = `
      .player-wrap { position: relative; border-radius: 10px; overflow: visible; }
      .trim-info {
        display: flex; align-items: center; justify-content: center;
        padding: 6px 0; min-height: 24px;
      }
      .trim-badge {
        font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace;
        background: var(--surface); border: 1px solid var(--border);
        padding: 2px 10px; border-radius: 20px;
      }
      .trim-badge.active { color: var(--accent); border-color: var(--accent); background: rgba(124,58,237,0.08); }

      /* Trim overlay on the Plyr progress bar */
      .plyr__progress { position: relative !important; }
      .trim-overlay {
        position: absolute; top: -8px; left: 0; right: 0; bottom: -8px;
        pointer-events: none; z-index: 10;
      }
      .trim-overlay-left, .trim-overlay-right {
        position: absolute; top: 0; bottom: 0;
        background: rgba(0,0,0,0.45); pointer-events: none;
        transition: width 0.05s ease;
      }
      .trim-overlay-left { left: 0; border-radius: 4px 0 0 4px; }
      .trim-overlay-right { right: 0; border-radius: 0 4px 4px 0; }

      .trim-handle {
        position: absolute; top: -4px; bottom: -4px; width: 10px;
        background: var(--accent); border-radius: 3px; cursor: col-resize;
        pointer-events: auto; z-index: 11;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 4px rgba(124,58,237,0.4);
        transition: background 0.15s;
      }
      .trim-handle:hover, .trim-handle.dragging { background: var(--accent-hover); }
      .trim-handle::after {
        content: ''; width: 2px; height: 10px;
        background: rgba(255,255,255,0.7); border-radius: 1px;
      }
      .trim-handle-start { transform: translateX(-50%); }
      .trim-handle-end { transform: translateX(50%); }

      .trim-time-tooltip {
        position: absolute; top: -26px; left: 50%; transform: translateX(-50%);
        background: var(--fg); color: var(--bg); font-size: 10px;
        font-family: ui-monospace, monospace; padding: 2px 6px;
        border-radius: 4px; white-space: nowrap; pointer-events: none;
        opacity: 0; transition: opacity 0.15s;
      }
      .trim-handle.dragging .trim-time-tooltip,
      .trim-handle:hover .trim-time-tooltip { opacity: 1; }
    `;
    document.head.appendChild(trimStyle);
  }

  const video = document.getElementById('video') as HTMLVideoElement;
  enableScrubbingFor(video);
  const trimBadge = document.getElementById('trim-badge') as HTMLElement;

  // Initialize Plyr, then inject trim handles into the progress bar
  void (async () => {
    try {
      const { default: Plyr } = await import('plyr');
      const plyrCss = await import('plyr/dist/plyr.css?inline');
      const style = document.createElement('style');
      style.textContent = plyrCss.default;
      document.head.appendChild(style);

      const knownSec = Math.max(1, Math.round(state.durationMs / 1000));
      new Plyr(video, {
        controls: ['play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
        duration: knownSec,
      });

      // Wait for Plyr to render, then inject trim handles into the progress bar
      await new Promise((r) => setTimeout(r, 200));
      const progressContainer = document.querySelector('.plyr__progress') as HTMLElement;
      if (progressContainer) {
        initTrimOverlay(progressContainer);
      }
    } catch {
      // Plyr failed — native controls, no trim overlay
    }
  })();

  function initTrimOverlay(container: HTMLElement): void {
    // Create overlay elements
    const overlay = document.createElement('div');
    overlay.className = 'trim-overlay';

    const leftDim = document.createElement('div');
    leftDim.className = 'trim-overlay-left';
    const rightDim = document.createElement('div');
    rightDim.className = 'trim-overlay-right';

    const startHandle = document.createElement('div');
    startHandle.className = 'trim-handle trim-handle-start';
    startHandle.innerHTML = '<span class="trim-time-tooltip" id="tt-start">0:00</span>';

    const endHandle = document.createElement('div');
    endHandle.className = 'trim-handle trim-handle-end';
    endHandle.innerHTML = `<span class="trim-time-tooltip" id="tt-end">${fmtDuration(durationMs)}</span>`;

    overlay.appendChild(leftDim);
    overlay.appendChild(rightDim);
    overlay.appendChild(startHandle);
    overlay.appendChild(endHandle);
    container.style.position = 'relative';
    container.appendChild(overlay);

    const ttStart = document.getElementById('tt-start')!;
    const ttEnd = document.getElementById('tt-end')!;

    function updateOverlay(): void {
      const startPct = (trimStartMs / durationMs) * 100;
      const endPct = (trimEndMs / durationMs) * 100;
      leftDim.style.width = `${startPct}%`;
      rightDim.style.width = `${100 - endPct}%`;
      startHandle.style.left = `${startPct}%`;
      endHandle.style.right = `${100 - endPct}%`;
      ttStart.textContent = fmtDuration(trimStartMs);
      ttEnd.textContent = fmtDuration(trimEndMs);
      const isFull = trimStartMs === 0 && trimEndMs >= durationMs - 100;
      trimBadge.textContent = isFull ? '✂ Full video' : `✂ ${fmtDuration(trimStartMs)} – ${fmtDuration(trimEndMs)}`;
      trimBadge.classList.toggle('active', !isFull);
    }
    updateOverlay();

    // Drag logic for handles
    function makeDraggable(handle: HTMLElement, onDrag: (pct: number) => void): void {
      let dragging = false;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        handle.classList.add('dragging');
      });

      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        onDrag(pct);
        updateOverlay();
      });

      document.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          handle.classList.remove('dragging');
        }
      });
    }

    makeDraggable(startHandle, (pct) => {
      trimStartMs = Math.min(Math.round(pct * durationMs / 100) * 100, trimEndMs - 500);
      video.currentTime = trimStartMs / 1000;
    });

    makeDraggable(endHandle, (pct) => {
      trimEndMs = Math.max(Math.round(pct * durationMs / 100) * 100, trimStartMs + 500);
      video.currentTime = trimEndMs / 1000;
    });
  }

  // Try IndexedDB first (instant), fall back to Azure SAS URL
  void (async () => {
    try {
      const { loadBlob } = await import('../shared/indexeddb.js');
      const cached = await loadBlob('pending-recording');
      if (cached) {
        const objectUrl = URL.createObjectURL(cached);
        video.src = objectUrl;
        video.load();
        window.addEventListener('beforeunload', () => URL.revokeObjectURL(objectUrl));
        console.log('[velocap/preview] loaded from IndexedDB (instant)', cached.size);
        return;
      }
    } catch (e) {
      console.warn('[velocap/preview] IndexedDB load failed, using Azure URL', e);
    }
    video.src = state.readSasUrl;
    video.load();
    console.log('[velocap/preview] loaded from Azure SAS URL (fallback)');
  })();

  // Enforce trim bounds during playback
  video.addEventListener('timeupdate', () => {
    if (video.currentTime < trimStartMs / 1000 - 0.1) {
      video.currentTime = trimStartMs / 1000;
    }
    if (trimEndMs < durationMs && video.currentTime >= trimEndMs / 1000) {
      video.pause();
      video.currentTime = trimStartMs / 1000;
    }
  });

  video.addEventListener('error', () => {
    console.error('[velocap/preview] video error', video.error);
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
    // Route through the background's chrome.downloads call — uses the
    // readSasUrl directly. Falls back to opening the URL in a new tab.
    setStatus('Preparing download…');
    const res = await chrome.runtime.sendMessage({ kind: 'bg:download-preview' });
    if (res?.ok) {
      setStatus('✓ Download started', 'ok');
    } else {
      // Fall back: open the SAS URL directly — browser will download it.
      try {
        const a = document.createElement('a');
        a.href = state.readSasUrl;
        a.download = `velocap-${Date.now()}.webm`;
        a.click();
        setStatus('✓ Download started (fallback)', 'ok');
      } catch (e) {
        setStatus(`Download failed: ${res?.message ?? (e instanceof Error ? e.message : String(e))}`, 'err');
      }
    }
  });

  uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading…';
    discardBtn.disabled = true;
    downloadBtn.disabled = true;

    const isTrimmed = trimStartMs > 0 || trimEndMs < durationMs - 100;
    const res = await chrome.runtime.sendMessage({
      kind: 'bg:preview-upload',
      title: titleInput.value.trim() || undefined,
      ...(isTrimmed ? { trimStartMs, trimEndMs } : {}),
    });

    if (res?.ok) {
      try {
        await navigator.clipboard.writeText(res.url);
      } catch { /* ignore */ }

      uploadBtn.textContent = '✓ Uploaded';
      uploadBtn.disabled = false;
      uploadBtn.className = 'primary';
      setTimeout(() => {
        uploadBtn.textContent = 'Open';
        uploadBtn.onclick = () => window.open(res.url, '_blank');
      }, 1200);

      discardBtn.textContent = 'Close';
      discardBtn.className = 'ghost';
      discardBtn.disabled = false;
      discardBtn.onclick = () => window.close();

      downloadBtn.textContent = 'Copy Link';
      downloadBtn.className = 'secondary';
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

      setStatus('✓ Uploaded & copied to clipboard!', 'ok');
    } else {
      uploadBtn.textContent = 'Upload';
      uploadBtn.disabled = false;
      discardBtn.disabled = false;
      downloadBtn.disabled = false;
      setStatus(res?.message || 'Upload failed', 'err');
    }
  });
}

// ============================================================
// Screenshot annotation mode — Fabric.js canvas overlay
// ============================================================
async function renderScreenshot(state: PreviewState): Promise<void> {
  const fabric = await import('fabric');

  // Use local screenshotDataUrl for annotation canvas (Fabric.js needs data URL)
  const imgSrc = state.screenshotDataUrl || state.readSasUrl;

  metaEl.textContent = fmtSize(state.bytes);

  main.innerHTML = `
    <div class="annotation-toolbar" id="toolbar">
      <button id="tool-select" title="Select">🔲</button>
      <button id="tool-draw" title="Draw">✏️</button>
      <button id="tool-rect" title="Rectangle">▭</button>
      <button id="tool-circle" title="Circle">○</button>
      <button id="tool-arrow" title="Arrow">↗</button>
      <button id="tool-text" title="Text">T</button>
      <div class="separator"></div>
      <input type="color" id="tool-color" value="#ef4444" title="Color" />
      <div class="separator"></div>
      <button id="tool-undo" title="Undo">↩</button>
      <button id="tool-redo" title="Redo">↪</button>
      <button id="tool-clear" title="Clear all">🗑</button>
    </div>
    <div class="canvas-container" id="canvas-wrap">
      <canvas id="annotation-canvas"></canvas>
    </div>
    <div class="bottom-bar">
      <input id="title" type="text" placeholder="Title (optional)" />
      <button id="discard" class="ghost">Discard</button>
      <button id="download" class="secondary">Download</button>
      <button id="upload" class="primary">Upload</button>
    </div>
  `;

  // Load image to get natural dimensions
  const img = new Image();
  img.crossOrigin = 'anonymous'; // needed if loading from Azure SAS URL
  img.src = imgSrc;
  await new Promise<void>((resolve) => { img.onload = () => resolve(); });

  // Wait a frame for layout to settle, then size canvas to fill available width
  await new Promise(r => requestAnimationFrame(r));
  const container = document.getElementById('canvas-wrap')!;
  const maxW = Math.min(920, container.clientWidth);
  const scale = Math.min(maxW / img.naturalWidth, 1);
  const canvasW = Math.round(img.naturalWidth * scale);
  const canvasH = Math.round(img.naturalHeight * scale);

  const canvasEl = document.getElementById('annotation-canvas') as HTMLCanvasElement;

  const fabricCanvas = new fabric.Canvas(canvasEl, {
    width: canvasW,
    height: canvasH,
  });

  // Set background image
  const fabricImg = new fabric.FabricImage(img, {
    scaleX: scale,
    scaleY: scale,
    selectable: false,
    evented: false,
  });
  fabricCanvas.backgroundImage = fabricImg;
  fabricCanvas.renderAll();

  // --- Tool state ---
  type Tool = 'select' | 'draw' | 'rect' | 'circle' | 'arrow' | 'text';
  let currentTool: Tool = 'select';
  let strokeColor = '#ef4444';
  const undoStack: string[] = [];
  const redoStack: string[] = [];

  function saveState(): void {
    undoStack.push(JSON.stringify(fabricCanvas.toJSON()));
    redoStack.length = 0;
  }
  saveState();

  const toolIds: Record<string, Tool> = {
    'tool-select': 'select',
    'tool-draw': 'draw',
    'tool-rect': 'rect',
    'tool-circle': 'circle',
    'tool-arrow': 'arrow',
    'tool-text': 'text',
  };

  function setTool(tool: Tool): void {
    currentTool = tool;
    fabricCanvas.isDrawingMode = tool === 'draw';
    fabricCanvas.selection = tool === 'select';
    // Deselect objects when switching tools
    if (tool !== 'select') fabricCanvas.discardActiveObject();
    // Update active states
    Object.entries(toolIds).forEach(([id, t]) => {
      document.getElementById(id)?.classList.toggle('active', t === tool);
    });
  }

  Object.entries(toolIds).forEach(([id, tool]) => {
    document.getElementById(id)!.addEventListener('click', () => setTool(tool));
  });

  // Color picker
  const colorInput = document.getElementById('tool-color') as HTMLInputElement;
  colorInput.addEventListener('input', () => {
    strokeColor = colorInput.value;
    if (fabricCanvas.freeDrawingBrush) {
      fabricCanvas.freeDrawingBrush.color = strokeColor;
    }
  });

  // Drawing brush
  fabricCanvas.freeDrawingBrush = new fabric.PencilBrush(fabricCanvas);
  fabricCanvas.freeDrawingBrush.color = strokeColor;
  fabricCanvas.freeDrawingBrush.width = 3;

  // Shape drawing via mouse events
  let isDrawingShape = false;
  let originX = 0;
  let originY = 0;
  let activeShape: fabric.FabricObject | null = null;

  fabricCanvas.on('mouse:down', (opt) => {
    if (currentTool === 'text') {
      const pointer = fabricCanvas.getScenePoint(opt.e);
      const text = new fabric.IText('Type here', {
        left: pointer.x,
        top: pointer.y,
        fontSize: 18 / scale,
        fill: strokeColor,
        fontFamily: 'sans-serif',
      });
      fabricCanvas.add(text);
      fabricCanvas.setActiveObject(text);
      text.enterEditing();
      saveState();
      setTool('select');
      return;
    }
    if (!['rect', 'circle', 'arrow'].includes(currentTool)) return;
    isDrawingShape = true;
    const pointer = fabricCanvas.getScenePoint(opt.e);
    originX = pointer.x;
    originY = pointer.y;

    if (currentTool === 'rect') {
      activeShape = new fabric.Rect({
        left: originX, top: originY,
        width: 0, height: 0,
        fill: 'transparent', stroke: strokeColor, strokeWidth: 3,
      });
    } else if (currentTool === 'circle') {
      activeShape = new fabric.Ellipse({
        left: originX, top: originY,
        rx: 0, ry: 0,
        fill: 'transparent', stroke: strokeColor, strokeWidth: 3,
      });
    } else if (currentTool === 'arrow') {
      activeShape = new fabric.Line([originX, originY, originX, originY], {
        stroke: strokeColor, strokeWidth: 3,
      });
    }
    if (activeShape) {
      fabricCanvas.add(activeShape);
      fabricCanvas.selection = false;
    }
  });

  fabricCanvas.on('mouse:move', (opt) => {
    if (!isDrawingShape || !activeShape) return;
    const pointer = fabricCanvas.getScenePoint(opt.e);
    if (currentTool === 'rect') {
      (activeShape as fabric.Rect).set({
        width: Math.abs(pointer.x - originX),
        height: Math.abs(pointer.y - originY),
        left: Math.min(pointer.x, originX),
        top: Math.min(pointer.y, originY),
      });
    } else if (currentTool === 'circle') {
      (activeShape as fabric.Ellipse).set({
        rx: Math.abs(pointer.x - originX) / 2,
        ry: Math.abs(pointer.y - originY) / 2,
        left: Math.min(pointer.x, originX),
        top: Math.min(pointer.y, originY),
      });
    } else if (currentTool === 'arrow') {
      (activeShape as fabric.Line).set({ x2: pointer.x, y2: pointer.y });
    }
    fabricCanvas.renderAll();
  });

  fabricCanvas.on('mouse:up', (opt) => {
    if (isDrawingShape && activeShape) {
      // Add arrowhead triangle at the end of an arrow line
      if (currentTool === 'arrow') {
        const line = activeShape as fabric.Line;
        const x1 = line.x1!, y1 = line.y1!, x2 = line.x2!, y2 = line.y2!;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 15;
        const headAngle = Math.PI / 6;
        const arrowHead = new fabric.Polygon([
          { x: x2, y: y2 },
          { x: x2 - headLen * Math.cos(angle - headAngle), y: y2 - headLen * Math.sin(angle - headAngle) },
          { x: x2 - headLen * Math.cos(angle + headAngle), y: y2 - headLen * Math.sin(angle + headAngle) },
        ], {
          fill: strokeColor,
          stroke: strokeColor,
          strokeWidth: 1,
          selectable: false,
          evented: false,
        });
        fabricCanvas.add(arrowHead);
      }
      saveState();
      activeShape = null;
      isDrawingShape = false;
    }
  });

  fabricCanvas.on('path:created', () => saveState());

  // Undo / Redo
  document.getElementById('tool-undo')!.addEventListener('click', () => {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop()!);
    fabricCanvas.loadFromJSON(JSON.parse(undoStack[undoStack.length - 1])).then(() => {
      fabricCanvas.renderAll();
    });
  });
  document.getElementById('tool-redo')!.addEventListener('click', () => {
    if (redoStack.length === 0) return;
    const json = redoStack.pop()!;
    undoStack.push(json);
    fabricCanvas.loadFromJSON(JSON.parse(json)).then(() => {
      fabricCanvas.renderAll();
    });
  });
  document.getElementById('tool-clear')!.addEventListener('click', () => {
    fabricCanvas.getObjects().forEach((obj) => fabricCanvas.remove(obj));
    fabricCanvas.renderAll();
    saveState();
  });

  // --- Export flattened image at full resolution ---
  function exportAnnotatedImage(): string {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = img.naturalWidth;
    exportCanvas.height = img.naturalHeight;
    const ctx = exportCanvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    // Draw Fabric annotations scaled up to full res
    const fabricEl = fabricCanvas.toCanvasElement();
    ctx.drawImage(fabricEl, 0, 0, canvasW, canvasH, 0, 0, img.naturalWidth, img.naturalHeight);
    return exportCanvas.toDataURL('image/png');
  }

  // --- Upload / Download / Discard ---
  const statusEl = document.getElementById('status');
  const setStatus = (text: string, cls: 'ok' | 'err' | '' = '') => {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
  };
  const titleInput = document.getElementById('title') as HTMLInputElement;
  const discardBtn = document.getElementById('discard') as HTMLButtonElement;
  const downloadBtn = document.getElementById('download') as HTMLButtonElement;
  const uploadBtn = document.getElementById('upload') as HTMLButtonElement;

  discardBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ kind: 'bg:preview-discard' });
    window.close();
  });

  downloadBtn.addEventListener('click', () => {
    const annotatedDataUrl = exportAnnotatedImage();
    const a = document.createElement('a');
    a.href = annotatedDataUrl;
    a.download = `velocap-${Date.now()}.png`;
    a.click();
    setStatus('Download started', 'ok');
  });

  uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading…';
    discardBtn.disabled = true;
    downloadBtn.disabled = true;

    const annotatedDataUrl = exportAnnotatedImage();
    const res = await chrome.runtime.sendMessage({
      kind: 'bg:preview-upload',
      title: titleInput.value.trim() || undefined,
      annotatedDataUrl,
    });

    if (res?.ok) {
      try {
        await navigator.clipboard.writeText(res.url);
      } catch { /* ignore */ }

      uploadBtn.textContent = '✓ Uploaded';
      uploadBtn.disabled = false;
      uploadBtn.className = 'primary';
      setTimeout(() => {
        uploadBtn.textContent = 'Open';
        uploadBtn.onclick = () => window.open(res.url, '_blank');
      }, 1200);

      discardBtn.textContent = 'Close';
      discardBtn.className = 'ghost';
      discardBtn.disabled = false;
      discardBtn.onclick = () => window.close();

      downloadBtn.textContent = 'Copy Link';
      downloadBtn.className = 'secondary';
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
      uploadBtn.textContent = 'Upload';
      uploadBtn.disabled = false;
      discardBtn.disabled = false;
      downloadBtn.disabled = false;
      setStatus(res?.message || 'Upload failed', 'err');
    }
  });
}

// When running as an iframe inside a content-script modal, the `?embed=1`
// query param is set. In that mode, Close/Discard should tear down the
// parent modal (the iframe doesn't own its own tab).
const isEmbedded = new URLSearchParams(location.search).get('embed') === '1';

function closeOuter(): void {
  if (isEmbedded) {
    window.parent.postMessage({ tag: 'velocap/preview', action: 'close' }, '*');
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
  const raw = (await chrome.runtime.sendMessage({ kind: 'bg:get-pending-preview' })) as
    | (PreviewState & { empty?: never })
    | { empty: true }
    | undefined;
  if (!raw || raw.empty) {
    renderEmpty('Nothing to preview — the recording was already uploaded or discarded.');
    return;
  }
  const preview = raw as PreviewState;
  if (preview.mediaType === 'screenshot') {
    await renderScreenshot(preview);
  } else {
    render(preview);
  }
})();
