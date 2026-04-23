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
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
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
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
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
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
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

  // Success
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <div className="text-green-500 text-4xl mb-4">✓</div>
        <h1 className="text-xl font-semibold text-white mb-2">Extension Connected!</h1>
        <p className="text-muted-foreground mb-2">
          Signed in as <span className="text-white">{user?.primaryEmailAddress?.emailAddress}</span>
        </p>
        <p className="text-muted-foreground mb-6">
          You can now close this tab and use the extension.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90"
          >
            Close Tab
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 bg-muted text-white rounded-md hover:bg-muted/80"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
