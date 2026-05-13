// Offscreen document — runs a MediaRecorder on a tabCapture or desktopCapture
// stream, optionally mixed with microphone audio. MV3 service workers can't
// own a MediaStream, so we do the heavy lifting here.
//
// On stop: assembles the full blob, fixes WebM duration metadata via
// fix-webm-duration, saves to IndexedDB for instant preview, then uploads
// the fixed blob to Azure as a single PUT.

// Inline azure upload function — the offscreen doc is loaded as a non-module
// script (CRXJS strips type="module"), so static imports break at runtime.

async function putBlobSingle(
  sasUrl: string,
  data: Blob,
  contentType: string,
): Promise<void> {
  const sep = sasUrl.includes('?') ? '&' : '?';
  const url = `${sasUrl}${sep}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': contentType,
          'Content-Length': String(data.size),
        },
        body: data,
      });
      if (res.ok) return;
      lastErr = new Error(`PUT Blob failed: ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
  throw lastErr ?? new Error('PUT Blob failed after retries');
}

/**
 * Fix WebM duration metadata. MediaRecorder produces WebMs without a Duration
 * element in the EBML header, making them non-seekable. This patches the blob
 * with the correct duration so browsers can seek and show progress immediately.
 *
 * Inlined from fix-webm-duration (MIT) because the offscreen document runs as
 * a classic script (CRXJS strips type="module"), so import() is unavailable.
 */
function fixWebmDurationMetadata(blob: Blob, durationMs: number): Promise<Blob> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        try {
          const buf = new Uint8Array(reader.result as ArrayBuffer);
          const file = new EBMLContainer('File', 'File');
          file.setSource(buf);
          if (fixDurationInEBML(file, durationMs)) {
            const fixed = new Blob([file.source.buffer], { type: blob.type || 'video/webm' });
            console.log('[velocap/offscreen] WebM duration fixed', {
              original: blob.size,
              fixed: fixed.size,
            });
            resolve(fixed);
          } else {
            resolve(blob);
          }
        } catch (e) {
          console.warn('[velocap/offscreen] fix-webm-duration failed', e);
          resolve(blob);
        }
      };
      reader.readAsArrayBuffer(blob);
    } catch (e) {
      console.warn('[velocap/offscreen] fix-webm-duration failed', e);
      resolve(blob);
    }
  });
}

// Minimal EBML parser/writer inlined from fix-webm-duration (MIT license).
// Only the sections needed for Duration patching are included.
const EBML_SECTIONS: Record<number, { name: string; type: string }> = {
  0xa45dfa3: { name: 'EBML', type: 'Container' },
  0x8538067: { name: 'Segment', type: 'Container' },
  0x549a966: { name: 'Info', type: 'Container' },
  0xad7b1: { name: 'TimecodeScale', type: 'Uint' },
  0x489: { name: 'Duration', type: 'Float' },
};

class EBMLElement {
  name: string;
  type: string;
  source!: Uint8Array;
  data: any;
  constructor(name: string, type: string) {
    this.name = name;
    this.type = type;
  }
  updateBySource() {}
  setSource(s: Uint8Array) { this.source = s; this.updateBySource(); }
  updateByData() {}
  setData(d: any) { this.data = d; this.updateByData(); }
}

class EBMLUint extends EBMLElement {
  constructor(name: string) { super(name, 'Uint'); }
  updateBySource() {
    let hex = '';
    for (let i = 0; i < this.source.length; i++) hex += this.source[i].toString(16).padStart(2, '0');
    this.data = hex;
  }
  updateByData() {
    const len = this.data.length / 2;
    this.source = new Uint8Array(len);
    for (let i = 0; i < len; i++) this.source[i] = parseInt(this.data.substr(i * 2, 2), 16);
  }
  getValue() { return parseInt(this.data, 16); }
  setValue(v: number) {
    let h = v.toString(16);
    if (h.length % 2) h = '0' + h;
    this.setData(h);
  }
}

class EBMLFloat extends EBMLElement {
  constructor(name: string) { super(name, 'Float'); }
  updateBySource() {
    const rev = new Uint8Array(this.source).reverse();
    const FA = this.source.length === 4 ? Float32Array : Float64Array;
    this.data = new FA(rev.buffer)[0];
  }
  updateByData() {
    const FA = (this.source && this.source.length === 4) ? Float32Array : Float64Array;
    const arr = new FA([this.data]);
    this.source = new Uint8Array(arr.buffer).reverse();
  }
  getValue() { return this.data; }
  setValue(v: number) { this.setData(v); }
}

class EBMLContainer extends EBMLElement {
  offset = 0;
  constructor(name: string, type: string) { super(name, type || 'Container'); }

  readByte() { return this.source[this.offset++]; }
  readUint() {
    const first = this.readByte();
    const len = 8 - first.toString(2).length;
    let val = first - (1 << (7 - len));
    for (let i = 0; i < len; i++) { val = val * 256 + this.readByte(); }
    return val;
  }

  updateBySource() {
    this.data = [];
    this.offset = 0;
    while (this.offset < this.source.length) {
      const id = this.readUint();
      const size = this.readUint();
      const end = Math.min(this.offset + size, this.source.length);
      const payload = this.source.slice(this.offset, end);
      const sec = EBML_SECTIONS[id] || { name: 'Unknown', type: 'Unknown' };
      let el: EBMLElement;
      switch (sec.type) {
        case 'Container': el = new EBMLContainer(sec.name, sec.type); break;
        case 'Uint': el = new EBMLUint(sec.name); break;
        case 'Float': el = new EBMLFloat(sec.name); break;
        default: el = new EBMLElement(sec.name, sec.type); break;
      }
      el.setSource(payload);
      this.data.push({ id, data: el });
      this.offset = end;
    }
  }

  writeUint(val: number, draft?: string) {
    let len = 1, limit = 128;
    while (val >= limit && len < 8) { len++; limit *= 128; }
    if (!draft) {
      let acc = limit + val;
      for (let i = len - 1; i >= 0; i--) {
        this.source[this.offset + i] = acc % 256;
        acc = (acc - acc % 256) / 256;
      }
    }
    this.offset += len;
  }

  writeSections(draft?: string) {
    this.offset = 0;
    for (const sec of this.data) {
      const payload = sec.data.source;
      this.writeUint(sec.id, draft);
      this.writeUint(payload.length, draft);
      if (!draft) this.source.set(payload, this.offset);
      this.offset += payload.length;
    }
    return this.offset;
  }

  updateByData() {
    const size = this.writeSections('draft');
    this.source = new Uint8Array(size);
    this.writeSections();
  }

  getSectionById(id: number): any {
    for (const sec of this.data) { if (sec.id === id) return sec.data; }
    return null;
  }
}

function fixDurationInEBML(file: EBMLContainer, durationMs: number): boolean {
  const segment = file.getSectionById(0x8538067) as EBMLContainer | null;
  if (!segment) return false;
  const info = segment.getSectionById(0x549a966) as EBMLContainer | null;
  if (!info) return false;
  const timecodeScale = info.getSectionById(0xad7b1) as EBMLUint | null;
  if (!timecodeScale) return false;

  let duration = info.getSectionById(0x489) as EBMLFloat | null;
  if (duration) {
    if (duration.getValue() > 0) return false; // already has valid duration
    duration.setValue(durationMs);
  } else {
    duration = new EBMLFloat('Duration');
    duration.setValue(durationMs);
    info.data.push({ id: 0x489, data: duration });
  }

  timecodeScale.setValue(1_000_000);
  info.updateByData();
  segment.updateByData();
  file.updateByData();
  return true;
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
  uploadSasUrl: string;
  totalBytes: number;
}

let session: Session | null = null;

function pickMime(): string {
  // Prefer MP4/H.264 so Safari can play recordings directly from the share
  // page — Chrome's MediaRecorder shipped MP4 support in Chrome 130+ via
  // https://chromestatus.com/feature/5163469011943424. Falls back to VP9
  // WebM (sharp + small) and then VP8 on the rare browser that lacks both.
  //
  // Order matters:
  //   1. MP4 Main profile + AAC — best quality, hardware-accelerated, plays
  //      everywhere including Safari + QuickTime.
  //   2. MP4 Baseline + AAC — older H.264 profile, broader hw decode coverage.
  //   3. WebM VP9 — Chrome legacy path; ~30 % sharper than VP8 at same bitrate.
  //   4. WebM VP8 — last resort.
  const candidates = [
    'video/mp4;codecs="avc1.4D0028,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
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
  // Issue 11 (round 3): bump MP4 bitrate again — even at 8/12 Mbps, H.264
  // looks soft on screen captures with small text. Going to 12/20 Mbps
  // matches what Loom uses for tab captures and gives sharp text edges.
  // File size cost: ~150 KB/s for tab, ~250 KB/s for display — a 1-minute
  // recording is ~9 MB tab / 15 MB display. Still very reasonable.
  const isMp4 = mimeType.startsWith('video/mp4');
  const videoBitsPerSecond =
    msg.source === 'display'
      ? (isMp4 ? 20_000_000 : 10_000_000)
      : (isMp4 ? 12_000_000 : 6_000_000);
  // Audio bitrate stays — 128 kbps is already fine for speech.
  const audioBitsPerSecond = 128_000;

  // Log the chosen settings so support cases can confirm what was actually
  // negotiated (codec / bitrate / source resolution).
  const videoTrack = combined.getVideoTracks()[0];
  const videoSettings = videoTrack?.getSettings?.() ?? {};
  console.log('[velocap/offscreen] encoder config', {
    mimeType,
    source: msg.source,
    videoBitsPerSecond,
    audioBitsPerSecond,
    width: videoSettings.width,
    height: videoSettings.height,
    frameRate: videoSettings.frameRate,
  });

  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond,
    audioBitsPerSecond,
  });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    console.log('[velocap/offscreen] ondataavailable:', e.data.size, 'bytes');
    if (!e.data.size) return;
    chunks.push(e.data);
    if (session) {
      session.totalBytes += e.data.size;
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
        totalBytes: s.totalBytes,
      });

      // 1. Assemble full blob from chunks
      const actualMime = chunks[0]?.type || s.mimeType || 'video/webm';
      const fullBlob = new Blob(chunks, { type: actualMime });

      // 2. Fix WebM duration metadata (makes video instantly seekable)
      const blobToUpload = actualMime.includes('webm') && durationMs > 0
        ? await fixWebmDurationMetadata(fullBlob, durationMs)
        : fullBlob;

      // 3. Save fixed blob to IndexedDB for instant preview (non-fatal)
      try {
        await _saveBlob('pending-recording', blobToUpload);
        console.log('[velocap/offscreen] saved to IndexedDB', { size: blobToUpload.size });
      } catch (e) {
        console.warn('[velocap/offscreen] IndexedDB save failed (preview will use Azure URL)', e);
      }

      // 4. Upload the fixed blob to Azure as a single PUT
      await putBlobSingle(s.uploadSasUrl, blobToUpload, actualMime);
      console.log('[velocap/offscreen] blob uploaded to Azure', { size: blobToUpload.size });

      await chrome.runtime.sendMessage({
        target: 'bg',
        kind: 'upload-complete',
        durationMs,
        bytes: blobToUpload.size,
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
    totalBytes: 0,
    ...(note ? { note } : {}),
  };

  // 1-second timeslice: chunks collected locally, uploaded as one blob on stop.
  recorder.start(1000);
  console.log('[velocap/offscreen] recorder started (1s timeslice)');
}

function stop(): void {
  console.log('[velocap/offscreen] stop called, session:', !!session);
  // Fix Issue 7: previously this returned silently when there was no session or
  // when the recorder was already inactive — leaving the background waiting
  // forever for `upload-complete`. Now we always report back so the popup gets
  // a clear error instead of a hung Stop button.
  if (!session) {
    void chrome.runtime.sendMessage({
      target: 'bg',
      kind: 'recorder-error',
      message: 'No active recording session in offscreen document.',
    } satisfies ErrorMsg);
    return;
  }
  console.log('[velocap/offscreen] recorder state:', session.recorder.state);
  if (session.recorder.state === 'inactive') {
    // Recorder already torn down (e.g. Chrome killed it). Tell bg so it
    // resolves the waiter instead of hanging.
    session = null;
    void chrome.runtime.sendMessage({
      target: 'bg',
      kind: 'recorder-error',
      message: 'Recorder was already inactive when Stop was clicked.',
    } satisfies ErrorMsg);
    return;
  }
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
  (msg: StartMsg | StopMsg | { target: 'offscreen'; kind: 'ping' | 'pickMime' }, _sender, sendResponse) => {
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
    if (msg.kind === 'pickMime') {
      // Background needs to know the file extension before calling /uploads/init,
      // but MediaRecorder isn't available in MV3 service workers — only in the
      // offscreen document. Return both the chosen mimeType and a matching ext.
      const mimeType = pickMime();
      const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
      sendResponse({ mimeType, ext });
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
