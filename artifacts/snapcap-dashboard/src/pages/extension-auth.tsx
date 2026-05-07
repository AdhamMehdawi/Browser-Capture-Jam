import { useEffect, useState } from "react";
import { useAuth, useUser, SignIn } from "@clerk/react";
import { useSearch } from "wouter";

// Declare chrome types for external messaging
declare const chrome: {
  runtime?: {
    sendMessage?: (
      extensionId: string,
      message: unknown,
      callback?: (response: unknown) => void
    ) => void;
  };
};

/**
 * Extension Auth Callback Page
 *
 * This page handles the OAuth-like flow for authenticating the Chrome extension:
 * 1. User clicks "Sign in" in extension popup
 * 2. Extension opens this page with extensionId parameter
 * 3. User signs in via Clerk (if not already signed in)
 * 4. This page gets the Clerk session token
 * 5. Sends token to extension via chrome.runtime.sendMessage
 * 6. Shows success message
 */
export default function ExtensionAuth() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const extensionId = params.get("extensionId");

  const [status, setStatus] = useState<"loading" | "sending" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      // Will show sign-in form below
      setStatus("loading");
      return;
    }

    if (!extensionId) {
      setError("Missing extension ID. Please try signing in from the extension again.");
      setStatus("error");
      return;
    }

    // Send token to extension
    async function sendTokenToExtension() {
      setStatus("sending");
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Could not get session token");
        }

        // Try to send to extension
        // Chrome extension external messaging requires the extension to declare
        // externally_connectable in manifest.json
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            await new Promise<void>((resolve, reject) => {
              chrome.runtime!.sendMessage!(extensionId!, {
                kind: "clerk-auth-callback",
                token,
              }, (response: unknown) => {
                if ((response as { ok?: boolean })?.ok) {
                  resolve();
                } else {
                  reject(new Error("Extension did not acknowledge"));
                }
              });
              // Timeout in case extension doesn't respond
              setTimeout(() => resolve(), 1000);
            });
            setStatus("success");
          } catch (e) {
            // Extension might not be available, try alternate method
            console.warn("Direct extension message failed:", e);
            // Store in localStorage for extension to pick up
            localStorage.setItem("veloqa_extension_auth", JSON.stringify({
              token,
              timestamp: Date.now(),
              extensionId,
            }));
            setStatus("success");
          }
        } else {
          // Store in localStorage for extension to pick up
          localStorage.setItem("veloqa_extension_auth", JSON.stringify({
            token,
            timestamp: Date.now(),
            extensionId,
          }));
          setStatus("success");
        }
      } catch (e) {
        console.error("Failed to send token to extension:", e);
        setError(e instanceof Error ? e.message : "Failed to authenticate extension");
        setStatus("error");
      }
    }

    void sendTokenToExtension();
  }, [isLoaded, isSignedIn, extensionId, getToken]);

  // Not signed in - show Clerk sign-in
  if (isLoaded && !isSignedIn) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Sign in to Velo QA</h1>
          <p className="text-muted-foreground">Sign in to connect your Chrome extension</p>
        </div>
        <SignIn
          routing="hash"
          fallbackRedirectUrl={`/extension-auth?extensionId=${extensionId}`}
        />
      </div>
    );
  }

  // Loading
  if (status === "loading" || status === "sending") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">
            {status === "loading" ? "Loading..." : "Connecting extension..."}
          </h1>
          <p className="text-muted-foreground">Please wait</p>
        </div>
      </div>
    );
  }

  // Error
  if (status === "error") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-4xl mb-4">✕</div>
          <h1 className="text-xl font-semibold text-white mb-2">Authentication Failed</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Try to close the tab, redirect to dashboard if it fails
  const handleClose = () => {
    // Try window.close() first (works if tab was opened by JS)
    window.close();
    // If we're still here after a short delay, redirect to dashboard
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 100);
  };

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  const signedInAs =
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    user?.username ||
    user?.fullName ||
    fullName ||
    null;

  // Success
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 ring-4 ring-emerald-500/20">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-10 w-10 text-emerald-400"
            aria-hidden="true"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>

        {signedInAs ? (
          <p className="mb-2 text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-semibold text-foreground">{signedInAs}</span>
          </p>
        ) : null}

        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          Extension Connected
        </h1>
        <p className="mb-7 text-sm text-muted-foreground">
          You can now close this tab and use the extension.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center sm:gap-3">
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go to Dashboard
          </a>
          <button
            onClick={handleClose}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Close Tab
          </button>
        </div>
      </div>
    </div>
  );
}
