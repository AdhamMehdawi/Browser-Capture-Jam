// Offscreen document — runs a MediaRecorder on a tabCapture or desktopCapture
// stream, optionally mixed with microphone audio. MV3 service workers can't
// own a MediaStream, so we do the heavy lifting here and ship the final
// WebM back as a base64 data URL.

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
};
type StopMsg = { target: 'offscreen'; kind: 'stop' };

type RecordedMsg = {
  target: 'bg';
  kind: 'recorded';
  dataUrl: string;
  durationMs: number;
  bytes: number;
  // Lets the popup surface a non-fatal hint like "mic was denied".
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
    if (e.data.size) chunks.push(e.data);
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
      console.log('[velocap/offscreen] finalizing', {
        chunkCount: chunks.length,
        chunkSizes: chunks.map((c) => c.size),
        mime: s.mimeType,
        firstChunkType: chunks[0]?.type,
      });

      // Use the actual MIME type from the first chunk if available,
      // as MediaRecorder may use a different format than requested.
      const actualMime = chunks[0]?.type || s.mimeType || 'video/webm';
      console.log('[velocap/offscreen] using actualMime:', actualMime);

      const raw = new Blob(chunks, { type: actualMime });
      const durationMs = Date.now() - s.startedAt;

      console.log('[velocap/offscreen] raw blob size:', raw.size, 'type:', raw.type);

      const dataUrl = await blobToDataUrl(raw);
      await chrome.runtime.sendMessage({
        target: 'bg',
        kind: 'recorded',
        dataUrl,
        durationMs,
        bytes: raw.size,
        ...(s.note ? { note: s.note } : {}),
      } satisfies RecordedMsg);
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
    ...(note ? { note } : {}),
  };

  // Start without timeslice - this produces a single complete WebM on stop.
  // Timeslice mode produces chunks that aren't independently valid WebM files.
  recorder.start();
  console.log('[velocap/offscreen] recorder started (no timeslice)');
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
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
