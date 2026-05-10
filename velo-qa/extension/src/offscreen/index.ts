// Offscreen document — runs a MediaRecorder on a tabCapture or desktopCapture
// stream, optionally mixed with microphone audio. MV3 service workers can't
// own a MediaStream, so we do the heavy lifting here.
//
// Streaming upload: chunks are uploaded directly to Azure via SAS URL during
// recording (Put Block per second). On stop, Put Block List commits them into
// a single playable blob. No base64, no dataUrl, no sendMessage size limits.

// Inline azure upload functions — the offscreen doc is loaded as a non-module
// script (CRXJS strips type="module"), so static imports break at runtime.

function _blockId(index: number): string {
  return btoa(String(index).padStart(6, '0'));
}

async function putBlock(sasUrl: string, index: number, data: Blob): Promise<void> {
  const id = _blockId(index);
  const sep = sasUrl.includes('?') ? '&' : '?';
  const url = `${sasUrl}${sep}comp=block&blockid=${encodeURIComponent(id)}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Length': String(data.size) },
        body: data,
      });
      if (res.ok) return;
      lastErr = new Error(`PUT Block ${index} failed: ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
  throw lastErr ?? new Error(`PUT Block ${index} failed after retries`);
}

async function putBlockList(sasUrl: string, blockCount: number): Promise<void> {
  const ids = Array.from({ length: blockCount }, (_, i) => _blockId(i));
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<BlockList>',
    ...ids.map((id) => `  <Latest>${id}</Latest>`),
    '</BlockList>',
  ].join('\n');
  const sep = sasUrl.includes('?') ? '&' : '?';
  const url = `${sasUrl}${sep}comp=blocklist`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/xml', 'x-ms-blob-content-type': 'video/webm' },
    body: xml,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Put Block List failed: ${res.status} ${res.statusText} — ${body}`);
  }
}

// Inline IndexedDB helper — save recording blob for instant preview.
const IDB_NAME = 'velocap';
const IDB_STORE = 'blobs';
function _openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE))
        req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _saveBlob(key: string, blob: Blob): Promise<void> {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

type StartMsg = {
  target: 'offscreen';
  kind: 'start';
  /** `tab` uses a chrome.tabCapture streamId. `display` uses getDisplayMedia (shows Chrome's native picker). */
  source: 'tab' | 'display';
  /** Only set when source === 'tab'. */
  streamId?: string;
  /** Request the shared-audio track that ships with the capture (tab audio). */
  captureAudio: boolean;
  /** Record the user's microphone too. */
  mic: boolean;
  /** SAS URL for direct-to-Azure block uploads. */
  uploadSasUrl: string;
};
type StopMsg = { target: 'offscreen'; kind: 'stop' };

type UploadCompleteMsg = {
  target: 'bg';
  kind: 'upload-complete';
  durationMs: number;
  bytes: number;
  blockCount: number;
  note?: string;
};
type ErrorMsg = { target: 'bg'; kind: 'recorder-error'; message: string };

interface Session {
  recorder: MediaRecorder;
  sources: MediaStream[];
  combined: MediaStream;
  audioCtx: AudioContext | null;
  chunks: Blob[];
  startedAt: number;
  mimeType: string;
  note?: string;
  // Streaming upload state
  uploadSasUrl: string;
  blockIndex: number;
  uploadQueue: Promise<void>;
  totalBytes: number;
  failedBlocks: number[];
}

let session: Session | null = null;

function pickMime(): string {
  // Use the simplest supported format for maximum compatibility.
  // Avoid complex codec strings that can cause demuxer issues.
  if (MediaRecorder.isTypeSupported('video/webm')) {
    return 'video/webm';
  }
  if (MediaRecorder.isTypeSupported('video/mp4')) {
    return 'video/mp4';
  }
  return '';
}

type ChromeMandatory = {
  chromeMediaSource: 'tab';
  chromeMediaSourceId: string;
};

async function getTabCaptureStream(
  streamId: string,
  withAudio: boolean,
): Promise<{ stream: MediaStream; audioNote?: string }> {
  const videoConstraint: { mandatory: ChromeMandatory } = {
    mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
  };
  const audioConstraint: { mandatory: ChromeMandatory } = {
    mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
  };
  if (withAudio) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint as unknown as MediaTrackConstraints,
        audio: audioConstraint as unknown as MediaTrackConstraints,
      });
      return { stream };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraint as unknown as MediaTrackConstraints,
      });
      return { stream, audioNote: `Tab audio unavailable (${msg})` };
    }
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraint as unknown as MediaTrackConstraints,
  });
  return { stream };
}

/**
 * Standard-web-API screen capture. Shows Chrome's native picker (screen /
 * window / tab, with "Share audio" checkbox when applicable). Avoids the
 * cross-context streamId issues that chrome.desktopCapture has when called
 * from an MV3 service worker.
 */
async function getDisplayCaptureStream(
  withAudio: boolean,
): Promise<{ stream: MediaStream; audioNote?: string }> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30 },
        displaySurface: 'monitor',
      } as MediaTrackConstraints,
      audio: withAudio,
      // @ts-ignore — Chrome-specific: hide the "Chrome Tab" option
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'include',
    } as DisplayMediaStreamOptions);
    return { stream };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (withAudio) {
      // Retry silently — user may have only granted video.
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30 },
            displaySurface: 'monitor',
          } as MediaTrackConstraints,
          audio: false,
          // @ts-ignore
          preferCurrentTab: false,
          selfBrowserSurface: 'exclude',
          monitorTypeSurfaces: 'include',
        } as DisplayMediaStreamOptions);
        return { stream, audioNote: `System audio unavailable (${msg})` };
      } catch {
        // fall through
      }
    }
    throw e;
  }
}

async function start(msg: StartMsg): Promise<void> {
  console.log('[velocap/offscreen] start', {
    source: msg.source,
    captureAudio: msg.captureAudio,
    mic: msg.mic,
  });
  if (session) throw new Error('Recording already in progress');

  const sources: MediaStream[] = [];
  let note: string | undefined;

  // 1. Capture the video source. Tab path uses the provided streamId;
  //    display path calls getDisplayMedia and shows Chrome's own picker.
  const capture =
    msg.source === 'tab'
      ? await getTabCaptureStream(msg.streamId!, msg.captureAudio)
      : await getDisplayCaptureStream(msg.captureAudio);
  const captureStream = capture.stream;
  sources.push(captureStream);
  if (capture.audioNote) note = note ? `${note}; ${capture.audioNote}` : capture.audioNote;

  // 2. Microphone (best effort — if denied, record silently).
  let micStream: MediaStream | null = null;
  if (msg.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      sources.push(micStream);
    } catch (e) {
      note = `Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 3. Combine: use Web Audio to mix capture audio + mic if we have both.
  let audioCtx: AudioContext | null = null;
  const captureAudioTracks = captureStream.getAudioTracks();
  const micAudioTracks = micStream ? micStream.getAudioTracks() : [];
  let finalAudioTracks: MediaStreamTrack[] = [];

  if (captureAudioTracks.length && micAudioTracks.length) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaStreamSource(new MediaStream(captureAudioTracks)).connect(dest);
    audioCtx.createMediaStreamSource(new MediaStream(micAudioTracks)).connect(dest);
    finalAudioTracks = dest.stream.getAudioTracks();
  } else if (captureAudioTracks.length) {
    finalAudioTracks = captureAudioTracks;
  } else if (micAudioTracks.length) {
    finalAudioTracks = micAudioTracks;
  }

  const combined = new MediaStream([
    ...captureStream.getVideoTracks(),
    ...finalAudioTracks,
  ]);

  const mimeType = pickMime();
  console.log('[velocap/offscreen] using mimeType:', mimeType);
  console.log('[velocap/offscreen] video tracks:', combined.getVideoTracks().length);
  console.log('[velocap/offscreen] audio tracks:', combined.getAudioTracks().length);

  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 2_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    console.log('[velocap/offscreen] ondataavailable:', e.data.size, 'bytes');
    if (!e.data.size) return;
    chunks.push(e.data);
    // Stream this chunk to Azure
    const s = session;
    if (s) {
      const idx = s.blockIndex++;
      s.totalBytes += e.data.size;
      s.uploadQueue = s.uploadQueue
        .then(() => putBlock(s.uploadSasUrl, idx, e.data))
        .catch((err) => {
          console.error(`[velocap/offscreen] putBlock ${idx} failed:`, err);
          s.failedBlocks.push(idx);
        });
    }
  };

  recorder.onerror = (e) => {
    const err = (e as ErrorEvent).error;
    void chrome.runtime.sendMessage({
      target: 'bg',
      kind: 'recorder-error',
      message: err?.message ?? 'MediaRecorder error',
    } satisfies ErrorMsg);
  };

  recorder.onstop = async () => {
    const s = session;
    session = null;
    if (!s) return;
    // Cleanly shut down all inputs and the mixer.
    for (const src of s.sources) src.getTracks().forEach((t) => t.stop());
    if (s.audioCtx) void s.audioCtx.close().catch(() => undefined);
    try {
      const durationMs = Date.now() - s.startedAt;
      console.log('[velocap/offscreen] finalizing', {
        chunkCount: chunks.length,
        blockIndex: s.blockIndex,
        totalBytes: s.totalBytes,
        failedBlocks: s.failedBlocks,
      });

      // Wait for all pending block uploads to complete
      await s.uploadQueue;
      console.log('[velocap/offscreen] all blocks uploaded');

      // Retry any failed blocks from local chunks
      for (const idx of s.failedBlocks) {
        if (chunks[idx]) {
          console.log(`[velocap/offscreen] retrying failed block ${idx}`);
          try {
            await putBlock(s.uploadSasUrl, idx, chunks[idx]);
          } catch (err) {
            console.error(`[velocap/offscreen] retry block ${idx} failed:`, err);
            throw new Error(`Block ${idx} failed after retry — upload incomplete`);
          }
        }
      }

      // Commit all blocks into a single blob
      await putBlockList(s.uploadSasUrl, s.blockIndex);
      console.log('[velocap/offscreen] block list committed');

      // Save blob to IndexedDB for instant preview (non-fatal if it fails)
      try {
        const actualMime = chunks[0]?.type || s.mimeType || 'video/webm';
        const fullBlob = new Blob(chunks, { type: actualMime });
        await _saveBlob('pending-recording', fullBlob);
        console.log('[velocap/offscreen] saved to IndexedDB', { size: fullBlob.size });
      } catch (e) {
        console.warn('[velocap/offscreen] IndexedDB save failed (preview will use Azure URL)', e);
      }

      await chrome.runtime.sendMessage({
        target: 'bg',
        kind: 'upload-complete',
        durationMs,
        bytes: s.totalBytes,
        blockCount: s.blockIndex,
        ...(s.note ? { note: s.note } : {}),
      } satisfies UploadCompleteMsg);
    } catch (err) {
      await chrome.runtime.sendMessage({
        target: 'bg',
        kind: 'recorder-error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies ErrorMsg);
    }
  };

  // Auto-stop when the capture source ends (user stops sharing via Chrome's
  // "Stop sharing" bar, closes the tab, etc.).
  captureStream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (session && session.recorder.state !== 'inactive') session.recorder.stop();
  });

  session = {
    recorder,
    sources,
    combined,
    audioCtx,
    chunks,
    startedAt: Date.now(),
    mimeType,
    uploadSasUrl: msg.uploadSasUrl,
    blockIndex: 0,
    uploadQueue: Promise.resolve(),
    totalBytes: 0,
    failedBlocks: [],
    ...(note ? { note } : {}),
  };

  // 1-second timeslice: each chunk is uploaded to Azure as a block during
  // recording. On stop, Put Block List commits all blocks into a single blob.
  recorder.start(1000);
  console.log('[velocap/offscreen] recorder started (1s timeslice, streaming to Azure)');
}

function stop(): void {
  console.log('[velocap/offscreen] stop called, session:', !!session);
  if (!session) return;
  console.log('[velocap/offscreen] recorder state:', session.recorder.state);
  if (session.recorder.state !== 'inactive') {
    // Force the recorder to flush its current buffer before stop so the
    // final WebM is complete even for very short recordings.
    try {
      session.recorder.requestData();
      console.log('[velocap/offscreen] requestData called');
    } catch (e) {
      console.log('[velocap/offscreen] requestData failed:', e);
    }
    session.recorder.stop();
    console.log('[velocap/offscreen] stop called on recorder');
  }
}

// Global error handler to catch any unhandled errors
self.onerror = (message, _source, _lineno, _colno, error) => {
  console.error('[velocap/offscreen] Global error:', message, error);
  chrome.runtime.sendMessage({
    target: 'bg',
    kind: 'recorder-error',
    message: `Offscreen error: ${message}`,
  });
};

self.onunhandledrejection = (event) => {
  console.error('[velocap/offscreen] Unhandled rejection:', event.reason);
  chrome.runtime.sendMessage({
    target: 'bg',
    kind: 'recorder-error',
    message: `Offscreen rejection: ${event.reason}`,
  });
};

chrome.runtime.onMessage.addListener(
  (msg: StartMsg | StopMsg | { target: 'offscreen'; kind: 'ping' }, _sender, sendResponse) => {
    // Ignore messages not targeted at offscreen - return false to not interfere
    if (msg?.target !== 'offscreen') {
      return false;
    }
    console.log('[velocap/offscreen] received message:', msg?.kind);
    if (msg.kind === 'ping') {
      console.log('[velocap/offscreen] responding to ping');
      sendResponse({ ok: true });
      return false;
    }
    if (msg.kind === 'start') {
      console.log('[velocap/offscreen] handling start');
      start(msg as StartMsg)
        .then(() => {
          console.log('[velocap/offscreen] start resolved, sending response');
          sendResponse({ ok: true });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[velocap/offscreen] start failed', err);
          sendResponse({ ok: false, message });
        });
      return true; // Keep message channel open for async response
    }
    if (msg.kind === 'stop') {
      console.log('[velocap/offscreen] stop');
      stop();
      sendResponse({ ok: true });
      return false;
    }
    console.log('[velocap/offscreen] unknown message kind:', (msg as { kind?: string }).kind);
    return false;
  },
);

console.log('[velocap/offscreen] script loaded and listener registered');
