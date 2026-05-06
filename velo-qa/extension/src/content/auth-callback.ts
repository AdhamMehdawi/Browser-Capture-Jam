// Content script that runs on the dashboard to pick up auth tokens
// This script checks for auth tokens stored by the extension-auth page

const AUTH_KEY = 'velocap_extension_auth';

function checkForAuthToken() {
  const stored = localStorage.getItem(AUTH_KEY);
  if (!stored) return;

  try {
    const data = JSON.parse(stored);
    // Only process if it's recent (within last 5 minutes)
    if (Date.now() - data.timestamp > 5 * 60 * 1000) {
      localStorage.removeItem(AUTH_KEY);
      return;
    }

    console.log('[velocap/auth-callback] Found auth token, sending to background');

    // Send to background script
    chrome.runtime.sendMessage({
      kind: 'auth-from-dashboard',
      token: data.token,
    }, (response) => {
      if (response?.ok) {
        console.log('[velocap/auth-callback] Auth stored successfully');
        // Clear the token from localStorage
        localStorage.removeItem(AUTH_KEY);
      } else {
        console.error('[velocap/auth-callback] Failed to store auth:', response?.error);
      }
    });
  } catch (e) {
    console.error('[velocap/auth-callback] Failed to parse auth token:', e);
  }
}

// Check immediately
checkForAuthToken();

// Also check periodically in case the token is set after this script loads
const interval = setInterval(() => {
  checkForAuthToken();
}, 500);

// Stop checking after 30 seconds
setTimeout(() => clearInterval(interval), 30000);
