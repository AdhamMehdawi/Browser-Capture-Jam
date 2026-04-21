// ============================================================
// Local-dev Clerk stub. Aliased in vite.config.ts when running
// without a real VITE_CLERK_PUBLISHABLE_KEY so the dashboard
// shell can render.
//
//   USE_CLERK_MOCK=1  → vite swaps "@clerk/react" for this file
//
// Everything here is deliberately minimal: the point is UI
// preview, not functional auth. Production builds should never
// resolve this module — CI should fail if it ships.
// ============================================================

import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

const FAKE_USER = {
  id: 'user_demo',
  firstName: 'Demo',
  lastName: 'User',
  fullName: 'Demo User',
  imageUrl: '',
  primaryEmailAddress: { emailAddress: 'demo@example.com' },
  emailAddresses: [{ emailAddress: 'demo@example.com' }],
};

interface ClerkCtx {
  isSignedIn: boolean;
  user: typeof FAKE_USER;
}

const Ctx = createContext<ClerkCtx>({ isSignedIn: true, user: FAKE_USER });

export function ClerkProvider({ children }: { children: ReactNode; [k: string]: unknown }) {
  return <Ctx.Provider value={{ isSignedIn: true, user: FAKE_USER }}>{children}</Ctx.Provider>;
}

export function useUser() {
  const c = useContext(Ctx);
  return {
    isSignedIn: c.isSignedIn,
    isLoaded: true,
    user: c.user,
  };
}

export function useAuth() {
  return {
    isSignedIn: true,
    isLoaded: true,
    userId: FAKE_USER.id,
    sessionId: 'sess_demo',
    async getToken() { return null; },
    async signOut() {},
  };
}

// Stable singleton so callers using `useClerk()` in useEffect deps don't
// see a new identity on every render (→ infinite re-render loop).
const CLERK_SINGLETON = {
  user: FAKE_USER,
  session: { id: 'sess_demo', user: FAKE_USER },
  async signOut() {
    // eslint-disable-next-line no-alert
    alert('Sign-out is disabled in Clerk-mock mode.');
  },
  openSignIn() {},
  openSignUp() {},
  redirectToSignIn() {},
  redirectToSignUp() {},
  // Clerk's client.addListener — subscribe to user/session changes. In
  // mock mode the user never changes, so we just return an unsubscribe
  // no-op and never invoke the callback (invoking it inside the
  // subscribe path triggers re-render storms in effects that depend on
  // the returned state).
  addListener(_cb: (state: { user: typeof FAKE_USER }) => void) {
    return () => {};
  },
};

export function useClerk() {
  return CLERK_SINGLETON;
}

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{
      padding: 32, maxWidth: 420, margin: '48px auto', textAlign: 'center',
      background: '#151922', border: '1px solid #22283a', borderRadius: 12, color: '#e6e9ef',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <h2 style={{ margin: '0 0 8px', color: '#ff4d7e' }}>{title}</h2>
      <p style={{ color: '#9aa3b2', fontSize: 14 }}>
        Running in <strong>Clerk-mock mode</strong>. Real sign-in isn't wired because
        <code style={{ background: '#22283a', padding: '2px 6px', borderRadius: 4, margin: '0 4px' }}>
          VITE_CLERK_PUBLISHABLE_KEY
        </code>
        isn't set.
      </p>
      <a href="/dashboard" style={{ color: '#ff4d7e', textDecoration: 'none', fontWeight: 600 }}>
        → Go to dashboard
      </a>
    </div>
  );
}

export function SignIn(_props: Record<string, unknown>) { return <Placeholder title="Sign In" />; }
export function SignUp(_props: Record<string, unknown>) { return <Placeholder title="Sign Up" />; }
export function SignedIn({ children }: { children: ReactNode }) { return <>{children}</>; }
export function SignedOut(_: { children: ReactNode }) { return null; }
// Clerk's <Show when="signed-in" /> / <Show when="signed-out" />. In mock
// mode we're always "signed-in" as the fake user, so only the signed-in
// branch renders; signed-out branches are dropped so redirects don't loop.
export function Show({
  when,
  children,
}: { when?: 'signed-in' | 'signed-out'; children: ReactNode; [k: string]: unknown }) {
  const isSignedIn = true;
  const match = when === 'signed-in' ? isSignedIn : when === 'signed-out' ? !isSignedIn : true;
  return match ? <>{children}</> : null;
}
export function UserButton(_props: Record<string, unknown>) {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%', background: '#ff4d7e',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: '#1a0914', fontWeight: 700, fontSize: 13,
    }} title="Demo User">D</div>
  );
}

export default {
  ClerkProvider,
  SignIn,
  SignUp,
  SignedIn,
  SignedOut,
  Show,
  UserButton,
  useUser,
  useAuth,
  useClerk,
};
