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
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m;
  return 'video/webm';
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
      video: { frameRate: { ideal: 30 } },
      audio: withAudio,
    });
    return { stream };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (withAudio) {
      // Retry silently — user may have only granted video.
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: false,
        });
        return { stream, audioNote: `System audio unavailable (${msg})` };
      } catch {
        // fall through
      }
    }
    throw e;
  }
}

async function start(msg: StartMsg): Promise<void> {
  console.log('[openjam/offscreen] start', {
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
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 2_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  recorder.onerror = (e) => {
    const err = (e as MediaRecorderErrorEvent).error;
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
      const blob = new Blob(chunks, { type: s.mimeType });
      const dataUrl = await blobToDataUrl(blob);
      await chrome.runtime.sendMessage({
        target: 'bg',
        kind: 'recorded',
        dataUrl,
        durationMs: Date.now() - s.startedAt,
        bytes: blob.size,
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
  recorder.start(250);
}

function stop(): void {
  if (!session) return;
  if (session.recorder.state !== 'inactive') session.recorder.stop();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener(
  (msg: StartMsg | StopMsg | { target: 'offscreen'; kind: 'ping' }, _sender, sendResponse) => {
    if (msg?.target !== 'offscreen') return undefined;
    if (msg.kind === 'ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (msg.kind === 'start') {
      start(msg as StartMsg)
        .then(() => {
          console.log('[openjam/offscreen] start resolved');
          sendResponse({ ok: true });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[openjam/offscreen] start failed', err);
          sendResponse({ ok: false, message });
        });
      return true;
    }
    if (msg.kind === 'stop') {
      console.log('[openjam/offscreen] stop');
      stop();
      sendResponse({ ok: true });
      return false;
    }
    return undefined;
  },
);

console.log('[openjam/offscreen] ready');
