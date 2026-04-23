import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import RecordingViewer from "@/pages/recording";
import SharedRecordingViewer from "@/pages/shared";
import Settings from "@/pages/settings";
import ExtensionAuth from "@/pages/extension-auth";
import Layout from "@/components/layout";

const queryClient = new QueryClient();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || "mock";
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(260, 80%, 55%)",
    colorBackground: "hsl(0, 0%, 100%)",
    colorInputBackground: "hsl(0, 0%, 97%)",
    colorText: "hsl(240, 10%, 10%)",
    colorTextSecondary: "hsl(240, 5%, 40%)",
    colorInputText: "hsl(240, 10%, 10%)",
    colorNeutral: "hsl(240, 5%, 90%)",
    borderRadius: "0.5rem",
    fontFamily: "'Inter', system-ui, sans-serif",
    fontFamilyButtons: "'Inter', system-ui, sans-serif",
    fontSize: "14px",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "border border-gray-200 shadow-lg rounded-xl w-full overflow-hidden bg-white",
    card: "!shadow-none !border-0 !bg-white !rounded-none",
    footer: "!shadow-none !border-0 !bg-zinc-900 !rounded-none",
    headerTitle: { color: "hsl(260, 80%, 55%)" },
    headerSubtitle: { color: "hsl(240, 5%, 40%)" },
    socialButtonsBlockButton: {
      backgroundColor: "hsl(0, 0%, 97%)",
      borderColor: "hsl(240, 5%, 85%)",
    },
    socialButtonsBlockButtonText: { color: "hsl(240, 10%, 20%)" },
    formFieldLabel: { color: "hsl(240, 5%, 40%)" },
    formFieldInput: {
      backgroundColor: "hsl(0, 0%, 100%)",
      borderColor: "hsl(240, 5%, 85%)",
      color: "hsl(240, 10%, 10%)",
    },
    footerActionLink: { color: "hsl(260, 80%, 55%)" },
    footerActionText: { color: "hsl(0, 0%, 70%)" },
    dividerText: { color: "hsl(240, 5%, 50%)" },
    dividerLine: { backgroundColor: "hsl(240, 5%, 90%)" },
    identityPreviewEditButton: { color: "hsl(260, 80%, 55%)" },
    formFieldSuccessText: { color: "hsl(142, 70%, 35%)" },
    alertText: { color: "hsl(0, 84%, 50%)" },
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

// Bridges Clerk's session token into the customFetch auth header so every
// API call carries `Authorization: Bearer <clerk-jwt>`. Needed because the
// dashboard and backend live on different origins; session cookies won't
// cross that boundary, but JWTs in headers will.
function ClerkApiTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/share/:token" component={SharedRecordingViewer} />
      <Route path="/extension-auth" component={ExtensionAuth} />

      <Route path="/dashboard">
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/recordings/:id">
        <ProtectedRoute component={RecordingViewer} />
      </Route>
      <Route path="/settings">
        <ProtectedRoute component={Settings} />
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkApiTokenBridge />
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
