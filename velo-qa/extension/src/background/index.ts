// Service worker. Orchestrates screenshot capture, video recording via an
// offscreen document, and upload to the server. State lives here so the
// popup can be closed/reopened during a recording.

import { api, ApiError } from '../shared/api.js';
import { getAuth } from '../shared/storage.js';
import { MSG } from '../types.js';
import type { CapturePayload } from '../types.js';

// ---------- types ----------
type CaptureRequest = { kind: 'bg:capture'; workspaceId: string; title?: string };
type RecordMode = 'tab' | 'screen';
type RecordStartReq = {
  kind: 'bg:record-start';
  mode: RecordMode;
  withMic: boolean;
  workspaceId: string;
  title?: string;
};
type RecordStopReq = { kind: 'bg:record-stop' };
type StateReq = { kind: 'bg:state' };

type BgResponse =
  | { ok: true; id: string; url: string; note?: string }
  | { ok: false; code: string; message: string };

type BgState =
  | { kind: 'idle' }
  | {
      kind: 'recording';
      startedAt: number;
      workspaceId: string;
      tabId: number;
      windowId: number;
      mode: RecordMode;
      /** Context captured at the start of recording - we'll merge with end context. */
      startContext: CapturePayload | null;
    }
  | { kind: 'processing'; workspaceId: string; startContext: CapturePayload | null }
  /**
   * Recording finished, blob captured, user hasn't decided yet. Data lives
   * in memory until they click Upload or Discard in the preview modal.
   */
  | {
      kind: 'pending-preview';
      workspaceId: string;
      tabId: number;
      dataUrl: string;
      durationMs: number;
      bytes: number;
      note?: string;
      /** Context captured during recording - merged start + end. */
      capturedContext: CapturePayload | null;
    };

let state: BgState = { kind: 'idle' };
let lastError: { code: string; message: string; at: number } | null = null;
/** Tab where the recording overlay was injected, so we can tear it down later. */
let overlayTabId: number | null = null;

async function showOverlayOn(tabId: number, startedAt: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'overlay:show', startedAt });
    overlayTabId = tabId;
  } catch {
    // Content script isn't present — inject it, then retry once.
    try {
      const manifest = chrome.runtime.getManifest();
      const isolated = manifest.content_scripts?.find(
        (cs) => (cs as { world?: string }).world !== 'MAIN',
      );
      if (isolated?.js?.length) {
        await chrome.scripting.executeScript({ target: { tabId }, files: isolated.js });
      }
      await chrome.tabs.sendMessage(tabId, { kind: 'overlay:show', startedAt });
      overlayTabId = tabId;
    } catch (e) {
      console.warn('[veloqa/bg] overlay inject failed', e);
    }
  }
}

async function hideOverlayIfAny(): Promise<void> {
  if (overlayTabId == null) return;
  try {
    await chrome.tabs.sendMessage(overlayTabId, { kind: 'overlay:hide' });
  } catch {
    // tab may be gone
  }
  overlayTabId = null;
}

function setError(code: string, message: string): void {
  lastError = { code, message, at: Date.now() };
  console.error('[veloqa/bg]', code, message);
}
function clearError(): void {
  lastError = null;
}

// ---------- helpers ----------
async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') throw new Error('No active tab');
  return tab;
}

function captureScreenshotDataUrl(windowId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      if (err || !dataUrl) return reject(new Error(err?.message ?? 'Screenshot failed'));
      resolve(dataUrl);
    });
  });
}

function sendOnce(tabId: number): Promise<CapturePayload> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { kind: MSG.capture }, (response: CapturePayload) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!response) return reject(new Error('No context returned'));
      resolve(response);
    });
  });
}

/**
 * Ensure the content script is present in a tab, then collect context.
 *
 * Chrome only injects manifest-declared content scripts on navigation, so a
 * tab opened before the extension was installed/reloaded has neither the
 * isolated-world collector nor the MAIN-world hook. We detect that (first
 * sendMessage fails) and inject both programmatically. The newly-injected
 * hook won't see events that already happened — the popup will tell the
 * user to reproduce the bug once after we inject.
 */
async function requestContext(tabId: number): Promise<{ payload: CapturePayload; injected: boolean }> {
  try {
    const payload = await sendOnce(tabId);
    return { payload, injected: false };
  } catch {
    // Fall through to injection.
  }
  try {
    // crxjs renames files with content hashes at build time. Read the real
    // paths out of the live manifest so we inject the same files Chrome
    // would have auto-injected on navigation.
    const manifest = chrome.runtime.getManifest();
    const mainWorld = manifest.content_scripts?.find(
      (cs) => (cs as { world?: string }).world === 'MAIN',
    );
    const isolated = manifest.content_scripts?.find(
      (cs) => (cs as { world?: string }).world !== 'MAIN',
    );
    if (mainWorld?.js?.length) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: mainWorld.js,
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
      });
    }
    if (isolated?.js?.length) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: isolated.js,
      });
    }
  } catch (e) {
    throw new Error(
      `Cannot capture this page: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // After injection the buffers are empty — we still return a valid payload.
  const payload = await sendOnce(tabId).catch(() => null);
  if (!payload) throw new Error('Content script did not respond after injection');
  return { payload, injected: true };
}

function fallbackContext(tab: chrome.tabs.Tab): CapturePayload {
  return {
    console: [],
    network: [],
    actions: [],
    device: { userAgent: 'unknown' },
    page: { url: tab.url ?? '', title: tab.title ?? '' },
  };
}

function unsupported(tab: chrome.tabs.Tab): BgResponse | null {
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    return {
      ok: false,
      code: 'unsupported_page',
      message: 'Browser internal pages cannot be captured',
    };
  }
  return null;
}

// ---------- offscreen doc lifecycle ----------
const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen/index.html');

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [OFFSCREEN_URL],
  });
  if (!existing.length) {
    console.log('[veloqa/bg] creating offscreen', OFFSCREEN_URL);
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [
        'USER_MEDIA' as chrome.offscreen.Reason,
        'DISPLAY_MEDIA' as chrome.offscreen.Reason,
      ],
      justification: 'Record screen/tab with optional mic for a Jam',
    });
  }
  // Wait for the offscreen doc's script to register its onMessage listener.
  // createDocument resolves when the doc is loaded, but scripts may still be
  // parsing — a ping handshake avoids losing the first `start` message.
  for (let i = 0; i < 20; i++) {
    try {
      const pong = await chrome.runtime.sendMessage({ target: 'offscreen', kind: 'ping' });
      if (pong?.ok) return;
    } catch {
      // listener not yet registered; retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Offscreen document did not become ready');
}

async function closeOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // already closed — fine
  }
}

// ---------- screenshot capture ----------
async function handleScreenshot(req: CaptureRequest): Promise<BgResponse> {
  try {
    const auth = await getAuth();
    if (!auth) return { ok: false, code: 'unauthenticated', message: 'Log in first' };

    const tab = await activeTab();
    if (!tab.id) return { ok: false, code: 'no_tab', message: 'No active tab' };
    const blocked = unsupported(tab);
    if (blocked) return blocked;

    const [screenshotDataUrl, ctxResult] = await Promise.all([
      captureScreenshotDataUrl(tab.windowId),
      requestContext(tab.id)
        .then((r) => ({ payload: r.payload, injected: r.injected }))
        .catch(() => ({ payload: fallbackContext(tab), injected: true })),
    ]);
    const ctx = ctxResult.payload;

    const jam = await api.createJam({
      workspaceId: req.workspaceId,
      type: 'SCREENSHOT',
      title: req.title ?? undefined,
      page: ctx.page,
      device: ctx.device,
      console: ctx.console,
      network: ctx.network,
      actions: ctx.actions,
      visibility: 'PUBLIC',
      media: { kind: 'screenshot', dataUrl: screenshotDataUrl },
    });
    const note = ctxResult.injected && ctx.console.length === 0 && ctx.network.length === 0
      ? 'No console/network — reload the page and reproduce before capturing.'
      : undefined;
    return { ok: true, id: jam.id, url: jam.url, note };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'capture_failed', message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- video recording ----------
function getTabStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      const err = chrome.runtime.lastError;
      if (err || !id) return reject(new Error(err?.message ?? 'Failed to acquire tab stream'));
      resolve(id);
    });
  });
}

async function handleRecordStart(req: RecordStartReq): Promise<BgResponse> {
  console.log('[veloqa/bg] record-start', req);
  clearError();
  try {
    if (state.kind !== 'idle') {
      return { ok: false, code: 'busy', message: 'A capture is already in progress' };
    }
    const auth = await getAuth();
    if (!auth) {
      setError('unauthenticated', 'Log in first');
      return { ok: false, code: 'unauthenticated', message: 'Log in first' };
    }

    const tab = await activeTab();
    if (!tab.id) return { ok: false, code: 'no_tab', message: 'No active tab' };
    const blocked = unsupported(tab);
    if (blocked) return blocked;
    console.log('[veloqa/bg] target tab', { id: tab.id, url: tab.url });

    let startPayload: Record<string, unknown>;
    if (req.mode === 'tab') {
      const streamId = await getTabStreamId(tab.id);
      startPayload = {
        source: 'tab',
        streamId,
        captureAudio: req.withMic, // try tab audio only if user wants audio
      };
    } else {
      // Full-screen path: delegate the whole thing to the offscreen doc.
      // It'll call getDisplayMedia() which shows Chrome's own picker and
      // returns a real MediaStream directly — no cross-context streamId.
      startPayload = { source: 'display', captureAudio: req.withMic };
    }

    console.log('[veloqa/bg] ensuring offscreen');
    await ensureOffscreen();
    console.log('[veloqa/bg] sending start to offscreen', {
      ...startPayload,
      mic: req.withMic,
    });
    const started: { ok: boolean; message?: string } | undefined = await chrome.runtime.sendMessage({
      target: 'offscreen',
      kind: 'start',
      ...startPayload,
      mic: req.withMic,
    });
    console.log('[veloqa/bg] offscreen started?', started);
    if (!started?.ok) {
      await closeOffscreen();
      let msg = started?.message ?? 'Recorder refused to start (offscreen did not respond)';
      // "NotAllowedError" from getDisplayMedia means the user clicked
      // Cancel on Chrome's picker — silent cancel, not an error.
      if (/NotAllowedError.*(user|cancel)|permission denied by user|dismissed/i.test(msg)) {
        setError('picker_cancelled', msg);
        return { ok: false, code: 'picker_cancelled', message: 'Recording cancelled' };
      }
      // macOS Screen Recording permission is the #1 cause of a hard-fail —
      // Chrome surfaces a generic "Error starting tab capture" in that case.
      if (/Error starting tab capture|NotReadableError|Permission denied by system/i.test(msg)) {
        msg =
          'macOS blocked the capture. Open System Settings → Privacy & Security → Screen Recording, enable Google Chrome, then quit and reopen Chrome.';
      }
      setError('recorder_start_failed', msg);
      return { ok: false, code: 'recorder_start_failed', message: msg };
    }

    const startedAt = Date.now();

    // Capture context at the START of recording so we have console/network
    // events that occurred before the user clicked stop. This is critical
    // because the buffers get cleared on page navigation.
    let startContext: CapturePayload | null = null;
    try {
      const ctxResult = await requestContext(tab.id);
      startContext = ctxResult.payload;
      console.log('[veloqa/bg] captured start context', {
        consoleCount: startContext.console.length,
        networkCount: startContext.network.length,
        actionsCount: startContext.actions.length,
      });
    } catch (e) {
      console.warn('[veloqa/bg] failed to capture start context', e);
    }

    state = {
      kind: 'recording',
      startedAt,
      workspaceId: req.workspaceId,
      tabId: tab.id,
      windowId: tab.windowId,
      mode: req.mode,
      startContext,
    };
    console.log('[veloqa/bg] state=recording');
    // Inject the floating recording bar on whatever tab the user was on —
    // for tab-mode that's the recorded tab itself; for full-screen it's just
    // a convenient place for the user to see the timer + stop button.
    void showOverlayOn(tab.id, startedAt);
    return { ok: true, id: '', url: '' };
  } catch (e) {
    await closeOffscreen().catch(() => undefined);
    state = { kind: 'idle' };
    const msg = e instanceof Error ? e.message : String(e);
    setError('record_start_failed', msg);
    return { ok: false, code: 'record_start_failed', message: msg };
  }
}

// Stop is asynchronous — the offscreen doc posts 'recorded' when done.
// Popup polls state until `pendingResult` lands.
let pendingResult: BgResponse | null = null;
let resultWaiters: Array<(r: BgResponse) => void> = [];

function resolveResult(res: BgResponse): void {
  pendingResult = res;
  const waiters = resultWaiters;
  resultWaiters = [];
  for (const w of waiters) w(res);
}

async function handleRecordStop(): Promise<BgResponse> {
  if (state.kind !== 'recording') {
    return { ok: false, code: 'not_recording', message: 'Not currently recording' };
  }
  const prev = state;
  state = { kind: 'processing', workspaceId: prev.workspaceId, startContext: prev.startContext };
  pendingResult = null;
  await chrome.runtime.sendMessage({ target: 'offscreen', kind: 'stop' });

  // Wait for the offscreen 'recorded' message, then upload.
  return new Promise<BgResponse>((resolve) => {
    resultWaiters.push(resolve);
  });
}

/**
 * Offscreen finished encoding. Don't upload yet — hand the blob to the
 * content script's preview modal and wait for the user's decision.
 */
async function onRecordedFromOffscreen(msg: {
  dataUrl: string;
  durationMs: number;
  bytes: number;
  note?: string;
}): Promise<void> {
  console.log('[veloqa/bg] recorded', {
    durationMs: msg.durationMs,
    bytes: msg.bytes,
    note: msg.note,
  });
  try {
    if (state.kind !== 'processing') {
      console.warn('[veloqa/bg] recorded delivered in state', state.kind);
      resolveResult({ ok: false, code: 'unexpected_state', message: 'Recorder delivered out of band' });
      return;
    }
    const workspaceId = state.workspaceId;
    const startContext = state.startContext;
    const tab = await activeTab().catch(() => null);
    const tabId = tab?.id ?? null;

    // Capture end context and merge with start context
    let capturedContext: CapturePayload | null = null;
    if (tabId != null) {
      try {
        const endCtxResult = await requestContext(tabId);
        const endContext = endCtxResult.payload;
        console.log('[veloqa/bg] captured end context', {
          consoleCount: endContext.console.length,
          networkCount: endContext.network.length,
          actionsCount: endContext.actions.length,
        });

        // Merge start and end contexts - dedupe by timestamp
        if (startContext) {
          const mergedConsole = [...startContext.console];
          const seenConsoleTs = new Set(mergedConsole.map((c) => c.timestamp));
          for (const c of endContext.console) {
            if (!seenConsoleTs.has(c.timestamp)) mergedConsole.push(c);
          }

          const mergedNetwork = [...startContext.network];
          const seenNetworkIds = new Set(mergedNetwork.map((n) => n.id));
          for (const n of endContext.network) {
            if (!seenNetworkIds.has(n.id)) mergedNetwork.push(n);
          }

          const mergedActions = [...startContext.actions];
          const seenActionTs = new Set(mergedActions.map((a) => a.timestamp));
          for (const a of endContext.actions) {
            if (!seenActionTs.has(a.timestamp)) mergedActions.push(a);
          }

          capturedContext = {
            console: mergedConsole,
            network: mergedNetwork,
            actions: mergedActions,
            device: endContext.device,
            page: endContext.page,
          };
          console.log('[veloqa/bg] merged context', {
            consoleCount: capturedContext.console.length,
            networkCount: capturedContext.network.length,
            actionsCount: capturedContext.actions.length,
          });
        } else {
          capturedContext = endContext;
        }
      } catch (e) {
        console.warn('[veloqa/bg] failed to capture end context', e);
        capturedContext = startContext;
      }
    } else {
      capturedContext = startContext;
    }

    state = {
      kind: 'pending-preview',
      workspaceId,
      tabId: tabId ?? -1,
      dataUrl: msg.dataUrl,
      durationMs: msg.durationMs,
      bytes: msg.bytes,
      capturedContext,
      ...(msg.note ? { note: msg.note } : {}),
    };

    // Hide the recording pill; the preview modal takes over.
    await hideOverlayIfAny();
    await closeOffscreen();

    // Unblock anyone waiting on the record-stop RPC with a "preview
    // pending" acknowledgement. Upload URL comes later via bg:preview-upload.
    resolveResult({ ok: true, id: '', url: '' });

    // Show the preview as an in-page popup (modal) on the recorded tab.
    // The content script injects an <iframe> pointed at the extension-origin
    // preview page, so CSP restrictions on the page don't affect video
    // playback. Falls back to opening in a new tab if messaging fails.
    if (tabId != null) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          kind: 'preview:show',
          dataUrl: msg.dataUrl,
          durationMs: msg.durationMs,
          bytes: msg.bytes,
          mimeType: 'video/webm',
          note: msg.note,
        });
      } catch (e) {
        console.warn('[veloqa/bg] preview:show failed; falling back to a tab', e);
        void chrome.tabs.create({ url: chrome.runtime.getURL('src/preview/index.html') });
      }
    } else {
      void chrome.tabs.create({ url: chrome.runtime.getURL('src/preview/index.html') });
    }
  } catch (e) {
    state = { kind: 'idle' };
    await closeOffscreen();
    await hideOverlayIfAny();
    setError('recorded_handoff_failed', e instanceof Error ? e.message : String(e));
    resolveResult({ ok: false, code: 'recorded_handoff_failed', message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * User clicked Upload in the preview modal. Package the buffered dataUrl
 * with the captured context (collected at start + end of recording) and POST to /jams.
 */
async function uploadPendingPreview(req: { title?: string }): Promise<BgResponse> {
  if (state.kind !== 'pending-preview') {
    return { ok: false, code: 'no_preview', message: 'Nothing to upload' };
  }
  const pending = state;
  try {
    // Use the context we captured during recording, not fresh context
    // (user may have navigated away, reloaded, etc.)
    const ctx = pending.capturedContext ?? fallbackContext({ url: '', title: '' } as chrome.tabs.Tab);

    console.log('[veloqa/bg] uploadPendingPreview: using captured context', {
      consoleCount: ctx.console.length,
      networkCount: ctx.network.length,
      actionsCount: ctx.actions.length,
    });

    const jam = await api.createJam({
      workspaceId: pending.workspaceId,
      type: 'VIDEO',
      title: req.title ?? undefined,
      page: ctx.page,
      device: ctx.device,
      console: ctx.console,
      network: ctx.network,
      actions: ctx.actions,
      durationMs: pending.durationMs,
      visibility: 'PUBLIC',
      media: { kind: 'video', dataUrl: pending.dataUrl },
    });
    state = { kind: 'idle' };
    return { ok: true, id: jam.id, url: jam.url, ...(pending.note ? { note: pending.note } : {}) };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: 'upload_failed', message: e instanceof Error ? e.message : String(e) };
  }
}

function discardPendingPreview(): void {
  state = { kind: 'idle' };
  setError('discarded', 'Recording discarded');
}

function onRecorderError(message: string): void {
  resolveResult({ ok: false, code: 'recorder_error', message });
  state = { kind: 'idle' };
  void closeOffscreen();
  void hideOverlayIfAny();
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Messages from offscreen have `target: 'bg'`.
  if (msg?.target === 'bg') {
    if (msg.kind === 'recorded') {
      void onRecordedFromOffscreen(msg);
      return false;
    }
    if (msg.kind === 'recorder-error') {
      onRecorderError(msg.message);
      return false;
    }
  }

  if (msg?.kind === 'bg:state') {
    const payload = state.kind === 'recording'
      ? { state: 'recording' as const, startedAt: state.startedAt, mode: state.mode }
      : state.kind === 'processing'
        ? { state: 'processing' as const }
        : pendingResult
          ? { state: 'result' as const, result: pendingResult }
          : lastError && Date.now() - lastError.at < 60_000
            ? {
                state: 'error' as const,
                error: { code: lastError.code, message: lastError.message },
              }
            : { state: 'idle' as const };
    sendResponse(payload);
    return false;
  }
  if (msg?.kind === 'bg:clear-error') {
    clearError();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.kind === 'bg:consume-result') {
    const res = pendingResult;
    pendingResult = null;
    sendResponse(res);
    return false;
  }
  if (msg?.kind === 'bg:capture') {
    void handleScreenshot(msg as CaptureRequest).then(sendResponse);
    return true;
  }
  if (msg?.kind === 'bg:record-start') {
    void handleRecordStart(msg as RecordStartReq).then(sendResponse);
    return true;
  }
  if (msg?.kind === 'bg:record-stop') {
    void handleRecordStop().then(sendResponse);
    return true;
  }
  if (msg?.kind === 'bg:preview-upload') {
    void uploadPendingPreview({ title: msg.title }).then(sendResponse);
    return true;
  }
  if (msg?.kind === 'bg:preview-discard') {
    discardPendingPreview();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.kind === 'bg:get-pending-preview') {
    if (state.kind !== 'pending-preview') {
      console.log('[veloqa/bg] get-pending-preview: no pending', state.kind);
      sendResponse({ empty: true });
      return false;
    }
    console.log('[veloqa/bg] get-pending-preview: returning', state.bytes, 'bytes');
    sendResponse({
      dataUrl: state.dataUrl,
      durationMs: state.durationMs,
      bytes: state.bytes,
      mimeType: 'video/webm',
      ...(state.note ? { note: state.note } : {}),
    });
    return false;
  }
  // Download the pending recording via chrome.downloads — more reliable than
  // an iframe <a download>, which Chrome sometimes blocks from cross-origin
  // frames embedded in third-party pages.
  if (msg?.kind === 'bg:download-preview') {
    if (state.kind !== 'pending-preview') {
      sendResponse({ ok: false, message: 'Nothing to download' });
      return false;
    }
    chrome.downloads.download(
      {
        url: state.dataUrl,
        filename: `veloqa-${Date.now()}.webm`,
        saveAs: true,
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err || downloadId == null) {
          console.error('[veloqa/bg] download failed', err);
          sendResponse({ ok: false, message: err?.message ?? 'Download failed' });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      },
    );
    return true; // async
  }
  return undefined;
});

// Safety net: if user navigates away from the captured tab, stop recording.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.kind === 'recording' && state.tabId === tabId) {
    void handleRecordStop();
  }
});

// Suppress unused type warnings for the readonly state req type.
void ({} as StateReq);
