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

// ============================================================
// Screenshot annotation mode — Fabric.js canvas overlay
// ============================================================
async function renderScreenshot(state: PreviewState): Promise<void> {
  const fabric = await import('fabric');

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
  img.src = state.dataUrl;
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
    const dataUrl = exportAnnotatedImage();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `veloqa-${Date.now()}.png`;
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
  const preview = state as PreviewState;
  if (preview.mediaType === 'screenshot') {
    await renderScreenshot(preview);
  } else {
    render(preview);
  }
})();
