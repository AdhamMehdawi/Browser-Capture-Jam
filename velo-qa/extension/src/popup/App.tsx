import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../shared/api.js';
import { clearAuth, getAuth, setAuth } from '../shared/storage.js';
import type { AuthState } from '../types.js';

type View = 'loading' | 'auth' | 'ready';

async function bootstrapDemo(): Promise<AuthState> {
  const res = await api.demoLogin();
  await setAuth({
    accessToken: res.accessToken,
    user: { id: '', email: '', name: null },
    workspaces: [],
    activeWorkspaceId: '',
  });
  const me = await api.me();
  const workspaces = me.user.memberships.map((m) => ({
    id: m.workspace.id,
    slug: m.workspace.slug,
    name: m.workspace.name,
    role: m.role,
  }));
  if (!workspaces.length) throw new Error('No workspace');
  const next: AuthState = {
    accessToken: res.accessToken,
    user: { id: me.user.id, email: me.user.email, name: me.user.name },
    workspaces,
    activeWorkspaceId: workspaces[0]!.id,
  };
  await setAuth(next);
  return next;
}

export function App() {
  const [view, setView] = useState<View>('loading');
  const [auth, setAuthState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const stored = await getAuth();
      if (!stored) {
        try {
          setAuthState(await bootstrapDemo());
          setView('ready');
        } catch {
          setView('auth');
        }
        return;
      }
      try {
        const me = await api.me();
        const workspaces = me.user.memberships.map((m) => ({
          id: m.workspace.id,
          slug: m.workspace.slug,
          name: m.workspace.name,
          role: m.role,
        }));
        const active =
          stored.activeWorkspaceId && workspaces.some((w) => w.id === stored.activeWorkspaceId)
            ? stored.activeWorkspaceId
            : workspaces[0]?.id;
        if (!active) throw new Error('no workspace');
        const next: AuthState = {
          accessToken: stored.accessToken,
          user: { id: me.user.id, email: me.user.email, name: me.user.name },
          workspaces,
          activeWorkspaceId: active,
        };
        await setAuth(next);
        setAuthState(next);
        setView('ready');
      } catch {
        await clearAuth();
        try {
          setAuthState(await bootstrapDemo());
          setView('ready');
        } catch {
          setView('auth');
        }
      }
    })();
  }, []);

  if (view === 'loading') {
    return (
      <div className="app">
        <div className="brand">Open<span>Jam</span></div>
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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password, name || undefined);
      await setAuth({
        accessToken: res.accessToken,
        user: { id: '', email, name: null },
        workspaces: [],
        activeWorkspaceId: '',
      });
      const me = await api.me();
      const workspaces = me.user.memberships.map((m) => ({
        id: m.workspace.id,
        slug: m.workspace.slug,
        name: m.workspace.name,
        role: m.role,
      }));
      if (!workspaces.length) throw new Error('No workspace available');
      const next: AuthState = {
        accessToken: res.accessToken,
        user: { id: me.user.id, email: me.user.email, name: me.user.name },
        workspaces,
        activeWorkspaceId: workspaces[0]!.id,
      };
      await setAuth(next);
      onDone(next);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="brand">Open<span>Jam</span></div>
      <p className="muted tiny">
        {mode === 'login' ? 'Sign in to capture' : 'Create an account'}
      </p>
      <form className="stack" onSubmit={submit}>
        {mode === 'register' && (
          <div>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
        )}
        <div>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={10}
            required
          />
        </div>
        <button className="primary" disabled={busy} type="submit">
          {busy ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <div className="error">{error}</div>
      </form>
      <div className="footer">
        <span className="tiny muted">
          {mode === 'login' ? 'New here?' : 'Have an account?'}
        </span>
        <button
          className="ghost tiny"
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? 'Create account' : 'Sign in'}
        </button>
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
  const [withMic, setWithMic] = useState(true);
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
    if (res?.ok) setUi({ kind: 'result', ok: true, url: res.url, note: res.note });
    else setUi({ kind: 'result', ok: false, error: res?.message ?? 'Capture failed' });
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
    await chrome.storage.local.set({ 'veloqa.auth': next });
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
      <div className="brand">Open<span>Jam</span></div>
      <div className="stack">
        <div>
          <label>Workspace</label>
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

        {!recording && (
          <>
            <button className="primary" disabled={busy} onClick={() => void screenshot()}>
              {ui.kind === 'screenshotting' ? (
                <span className="row" style={{ justifyContent: 'center', gap: 6 }}>
                  <span className="spinner" /> Capturing…
                </span>
              ) : (
                'Capture screenshot'
              )}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void startRecord('tab')}
              title="Fast path — records this tab. No OS picker needed."
            >
              ● Record this tab {withMic ? '+ mic' : '(silent)'}
            </button>
            <label
              className="row tiny muted"
              style={{ gap: 6, padding: '0 2px', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={withMic}
                onChange={(e) => setWithMic(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Include microphone
            </label>
            <button
              className="ghost"
              disabled={busy}
              onClick={() => void startRecord('screen')}
              title="Full OS picker — any screen, window, or tab. Needs Screen Recording permission on macOS."
            >
              ● Record full screen…
            </button>
          </>
        )}

        {recording && (
          <>
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'pulse 1s infinite',
                }}
              />
              <span>
                Recording {ui.kind === 'recording' ? `(${ui.mode})` : ''} · {fmtDuration(elapsed)}
              </span>
            </div>
            <button className="primary" onClick={() => void stopRecord()}>
              Stop & create Jam
            </button>
          </>
        )}

        {ui.kind === 'processing' && (
          <div className="muted row" style={{ justifyContent: 'center', gap: 6 }}>
            <span className="spinner" /> Uploading…
          </div>
        )}

        {ui.kind === 'result' && ui.ok && ui.url && (
          <>
            <div className="success">✓ Jam created</div>
            {ui.note && <div className="tiny muted">{ui.note}</div>}
            <a className="link" href={ui.url} target="_blank" rel="noreferrer">
              {ui.url}
            </a>
            <div className="row" style={{ gap: 6 }}>
              <button className="ghost tiny" onClick={() => void copyLink(ui.url!)}>
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <button
                className="ghost tiny"
                onClick={() => chrome.tabs.create({ url: ui.url! })}
              >
                Open
              </button>
              <button className="ghost tiny" onClick={() => setUi({ kind: 'idle' })}>
                New capture
              </button>
            </div>
          </>
        )}

        {ui.kind === 'result' && !ui.ok && (
          <>
            <div className="error">{ui.error}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {ui.needsScreenSetup && (
                <button
                  className="primary tiny"
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
                  className="primary tiny"
                  onClick={() =>
                    chrome.tabs.create({
                      url: chrome.runtime.getURL('src/permissions/index.html'),
                    })
                  }
                >
                  Fix mic permission
                </button>
              )}
              <button className="ghost tiny" onClick={() => setUi({ kind: 'idle' })}>
                Try again
              </button>
              {ui.needsMicSetup && (
                <button
                  className="ghost tiny"
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
      <div className="divider" />
      <div className="footer">
        <span className="tiny muted">{auth.user.email}</span>
        <button
          className="ghost tiny"
          onClick={() => void onSignOut()}
          disabled={recording || busy}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
