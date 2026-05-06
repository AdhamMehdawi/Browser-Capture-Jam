import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../shared/api.js';
import { clearAuth, getAuth, setAuth } from '../shared/storage.js';
import { DASHBOARD_URL } from '../shared/config.js';
import type { AuthState } from '../types.js';

type View = 'loading' | 'auth' | 'ready';

/**
 * Bootstrap auth with a Clerk JWT token.
 * Verifies the token with the API and creates an auth state.
 */
async function bootstrapWithClerkToken(token: string): Promise<AuthState> {
  const user = await api.verifyClerkToken(token);
  const next: AuthState = {
    accessToken: token,
    user: { id: user.userId, email: user.email ?? '', name: user.name },
    workspaces: [{ id: 'default', slug: 'default', name: 'My Recordings', role: 'owner' }],
    activeWorkspaceId: 'default',
  };
  await setAuth(next);
  return next;
}

export function App() {
  const [view, setView] = useState<View>('loading');
  const [auth, setAuthState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Listen for auth callback from dashboard
  useEffect(() => {
    const handleMessage = (
      message: { kind?: string; target?: string; token?: string },
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (response?: unknown) => void
    ): boolean => {
      // Ignore messages intended for other targets (offscreen, bg, etc.)
      // Return false to not interfere with their response handling
      if (message?.target) {
        return false;
      }
      if (message?.kind === 'clerk-auth-callback' && message.token) {
        const token = message.token;
        void (async () => {
          try {
            const next = await bootstrapWithClerkToken(token);
            setAuthState(next);
            setError(null);
            setView('ready');
          } catch (e) {
            console.error('[popup] Auth callback failed:', e);
            setError(e instanceof Error ? e.message : 'Authentication failed');
          }
        })();
        return false; // Not sending a response
      }
      return false; // Not handling this message
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    // Check for existing auth on startup
    void (async () => {
      try {
        const stored = await getAuth();
        console.log('[popup] Checking stored auth:', stored ? 'found' : 'none');
        if (stored && stored.accessToken && stored.user) {
          // Use stored auth directly - it was already validated when stored
          setAuthState(stored);
          setView('ready');
        } else {
          setView('auth');
        }
      } catch (e) {
        console.error('[popup] Auth check failed:', e);
        setError(e instanceof Error ? e.message : 'Session expired');
        setView('auth');
      }
    })();
  }, []);

  if (view === 'loading') {
    return (
      <div className="app">
        <div className="brand">Velo<span>QA</span></div>
        <div className="muted">Checking session…</div>
      </div>
    );
  }

  if (view === 'auth' || !auth) {
    return (
      <AuthForm
        onDone={(next) => {
          setAuthState(next);
          setError(null);
          setView('ready');
        }}
        initialError={error}
      />
    );
  }

  return (
    <Ready
      auth={auth}
      onUpdate={setAuthState}
      onSignOut={async () => {
        await clearAuth();
        setAuthState(null);
        setView('auth');
      }}
    />
  );
}

function AuthForm({
  onDone,
  initialError,
}: {
  onDone: (a: AuthState) => void;
  initialError: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function openDashboardLogin() {
    setError(null);
    setBusy(true);
    try {
      // Get the extension ID to construct callback URL
      const extensionId = chrome.runtime.id;
      const callbackUrl = `${DASHBOARD_URL}/extension-auth?extensionId=${extensionId}`;

      // Open the dashboard sign-in page with callback parameter
      await chrome.tabs.create({ url: callbackUrl });

      // The popup will close, but we'll get the auth when it reopens
      // after the user signs in and the callback is triggered
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed';
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="brand">Velo<span>QA</span></div>
      <p className="muted tiny">Sign in to start capturing</p>
      <div className="stack">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void openDashboardLogin()}
        >
          {busy ? <span className="spinner" /> : 'Sign in with Clerk'}
        </button>
        {error && <div className="error">{error}</div>}
      </div>
      <div className="footer">
        <span className="tiny muted">
          You'll be redirected to sign in via the dashboard
        </span>
      </div>
    </div>
  );
}

type UiState =
  | { kind: 'idle' }
  | { kind: 'screenshotting' }
  | { kind: 'recording'; startedAt: number; mode: 'tab' | 'screen' }
  | { kind: 'processing' }
  | {
      kind: 'result';
      ok: boolean;
      url?: string;
      error?: string;
      note?: string;
      needsMicSetup?: boolean;
      needsScreenSetup?: boolean;
    };

function classifyError(message: string | undefined): {
  needsMicSetup?: boolean;
  needsScreenSetup?: boolean;
} {
  if (!message) return {};
  if (/screen recording|macos blocked|starting tab capture/i.test(message)) {
    return { needsScreenSetup: true };
  }
  if (/microphone|mic/i.test(message)) {
    return { needsMicSetup: true };
  }
  return {};
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function Ready({
  auth,
  onUpdate,
  onSignOut,
}: {
  auth: AuthState;
  onUpdate: (a: AuthState) => void;
  onSignOut: () => void;
}) {
  const [ui, setUi] = useState<UiState>({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState(false);
  const [withMic, setWithMic] = useState(false);
  const tickRef = useRef<number | null>(null);

  const startTicker = useCallback(() => {
    if (tickRef.current) return;
    tickRef.current = window.setInterval(() => setTick((t) => t + 1), 500);
  }, []);
  const stopTicker = useCallback(() => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // On open, sync UI with the BG's current state (popup is ephemeral).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = (await chrome.runtime.sendMessage({ kind: 'bg:state' })) as
        | { state: 'idle' }
        | { state: 'recording'; startedAt: number; mode?: 'tab' | 'screen' }
        | { state: 'processing' }
        | { state: 'result'; result: { ok: boolean; url?: string; message?: string; note?: string } }
        | { state: 'error'; error: { code: string; message: string } };
      if (cancelled) return;
      if (s.state === 'recording') {
        setUi({ kind: 'recording', startedAt: s.startedAt, mode: s.mode ?? 'tab' });
        startTicker();
      } else if (s.state === 'processing') {
        setUi({ kind: 'processing' });
      } else if (s.state === 'result') {
        await chrome.runtime.sendMessage({ kind: 'bg:consume-result' });
        setUi({
          kind: 'result',
          ok: s.result.ok,
          url: s.result.url,
          error: s.result.ok ? undefined : s.result.message,
          note: s.result.note,
          ...(s.result.ok ? {} : classifyError(s.result.message)),
        });
      } else if (s.state === 'error') {
        // A prior start attempt failed while the popup was closed.
        await chrome.runtime.sendMessage({ kind: 'bg:clear-error' });
        setUi({
          kind: 'result',
          ok: false,
          error: s.error.message,
          ...classifyError(s.error.message),
        });
      }
    })();
    return () => {
      cancelled = true;
      stopTicker();
    };
  }, [startTicker, stopTicker]);

  async function screenshot() {
    setUi({ kind: 'screenshotting' });
    setCopied(false);
    const res = await chrome.runtime.sendMessage({
      kind: 'bg:capture',
      workspaceId: auth.activeWorkspaceId,
    });
    if (res?.ok) {
      // Screenshot now shows preview modal on the page — close popup
      window.close();
    } else {
      setUi({ kind: 'result', ok: false, error: res?.message ?? 'Capture failed' });
    }
  }

  /**
   * Offscreen docs can't show UI, so they can't prompt for mic permission —
   * but the popup is a regular extension page that can. Problem: if the user
   * previously denied mic, Chrome won't re-prompt inside a popup (it closes
   * too easily). So we also offer a fallback page in a real tab where the
   * prompt is guaranteed to render.
   */
  async function ensureMicPermission(): Promise<
    { ok: true } | { ok: false; error: string; needsSetup: boolean }
  > {
    // Fast path: already granted.
    try {
      const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (p.state === 'granted') return { ok: true };
      if (p.state === 'denied') {
        return {
          ok: false,
          needsSetup: true,
          error:
            'Microphone is blocked for this extension. Click "Fix mic permission" to reset it.',
        };
      }
    } catch {
      // Permissions API for microphone may not be available — fall through.
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const denied = /permission|denied|dismissed|NotAllowed/i.test(msg);
      return {
        ok: false,
        needsSetup: denied,
        error: denied
          ? 'Microphone was denied. Click "Fix mic permission" to grant it in a full tab.'
          : `Microphone error: ${msg}`,
      };
    }
  }

  async function startRecord(mode: 'tab' | 'screen') {
    setCopied(false);
    const wantMic = withMic;
    if (wantMic) {
      const perm = await ensureMicPermission();
      if (!perm.ok) {
        setUi({
          kind: 'result',
          ok: false,
          error: perm.error,
          needsMicSetup: perm.needsSetup,
        });
        return;
      }
    }
    setUi({ kind: 'screenshotting' }); // transient
    const res = await chrome.runtime.sendMessage({
      kind: 'bg:record-start',
      mode,
      withMic: wantMic,
      workspaceId: auth.activeWorkspaceId,
    });
    if (!res?.ok) {
      // Picker cancellation isn't really an error — reset to idle quietly.
      if (res?.code === 'picker_cancelled') {
        setUi({ kind: 'idle' });
        return;
      }
      const message = res?.message ?? 'Could not start recording';
      setUi({
        kind: 'result',
        ok: false,
        error: message,
        ...classifyError(message),
      });
      return;
    }
    setUi({ kind: 'recording', startedAt: Date.now(), mode });
    startTicker();
  }

  async function stopRecord() {
    stopTicker();
    setUi({ kind: 'processing' });
    const res = await chrome.runtime.sendMessage({ kind: 'bg:record-stop' });
    if (res?.ok) setUi({ kind: 'result', ok: true, url: res.url, note: res.note });
    else setUi({ kind: 'result', ok: false, error: res?.message ?? 'Recording failed' });
  }

  async function changeWorkspace(id: string) {
    const next = { ...auth, activeWorkspaceId: id };
    onUpdate(next);
    await chrome.storage.local.set({ 'velocap.auth': next });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  const recording = ui.kind === 'recording';
  const busy = ui.kind === 'screenshotting' || ui.kind === 'processing';
  const elapsed =
    ui.kind === 'recording' ? Date.now() - ui.startedAt : 0;
  // use tick so the elapsed label re-renders
  void tick;

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="brand">
          <img src={chrome.runtime.getURL('icons/logo.svg')} alt="VeloCap" className="brand-logo" />
          <span className="brand-name">VeloCap</span>
        </div>
        <span className="user-email">{auth.user.email}</span>
      </div>

      {/* Workspace selector */}
      <div>
        <div className="workspace-label">Workspace</div>
        <select
          value={auth.activeWorkspaceId}
          onChange={(e) => void changeWorkspace(e.target.value)}
          disabled={recording || busy}
        >
          {auth.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="stack">
        {!recording && (
          <>
            <button className="action-btn" disabled={busy} onClick={() => void screenshot()}>
              {ui.kind === 'screenshotting' ? (
                <>
                  <span className="spinner" /> Capturing…
                </>
              ) : (
                <><svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M12 7h.01"/></svg> Screenshot</>
              )}
            </button>
            <button
              className="action-btn"
              disabled={busy}
              onClick={() => void startRecord('tab')}
            >
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> Record Tab
            </button>
            <button
              className="action-btn"
              disabled={busy}
              onClick={() => void startRecord('screen')}
            >
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> Record Screen
            </button>
            <label className="mic-toggle">
              <input
                type="checkbox"
                checked={withMic}
                onChange={(e) => setWithMic(e.target.checked)}
              />
              Include microphone
            </label>
          </>
        )}

        {recording && (
          <>
            <div className="recording-indicator">
              <span className="recording-dot" />
              Recording {ui.kind === 'recording' ? `(${ui.mode})` : ''} · {fmtDuration(elapsed)}
            </div>
            <button className="danger" onClick={() => void stopRecord()}>
              ⏹ Stop Recording
            </button>
          </>
        )}

        {ui.kind === 'processing' && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 12, color: 'var(--muted)' }}>
            <span className="spinner" /> Uploading…
          </div>
        )}

        {ui.kind === 'result' && ui.ok && ui.url && (
          <>
            <div className="success-box">✓ Recording saved</div>
            {ui.note && <div className="note">{ui.note}</div>}
            <a className="link" href={ui.url} target="_blank" rel="noreferrer">
              {ui.url}
            </a>
            <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
              <button className="ghost" onClick={() => void copyLink(ui.url!)}>
                {copied ? '✓ Copied!' : '📋 Copy link'}
              </button>
              <button
                className="ghost"
                onClick={() => chrome.tabs.create({ url: ui.url! })}
              >
                🔗 Open
              </button>
              <button className="ghost" onClick={() => setUi({ kind: 'idle' })}>
                ＋ New
              </button>
            </div>
          </>
        )}

        {ui.kind === 'result' && !ui.ok && (
          <>
            <div className="error-box">{ui.error}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {ui.needsScreenSetup && (
                <button
                  className="primary"
                  style={{ fontSize: 12, padding: '8px 12px' }}
                  onClick={() =>
                    chrome.tabs.create({
                      url: chrome.runtime.getURL('src/permissions/screen.html'),
                    })
                  }
                >
                  Fix screen permission
                </button>
              )}
              {ui.needsMicSetup && (
                <button
                  className="primary"
                  style={{ fontSize: 12, padding: '8px 12px' }}
                  onClick={() =>
                    chrome.tabs.create({
                      url: chrome.runtime.getURL('src/permissions/index.html'),
                    })
                  }
                >
                  Fix mic permission
                </button>
              )}
              <button className="ghost" onClick={() => setUi({ kind: 'idle' })}>
                Try again
              </button>
              {ui.needsMicSetup && (
                <button
                  className="ghost"
                  onClick={() => {
                    setWithMic(false);
                    setUi({ kind: 'idle' });
                  }}
                >
                  Record without mic
                </button>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}
