import { defineManifest } from '@crxjs/vite-plugin';

// EXT_BUILD_MODE=release strips localhost URLs from externally_connectable,
// content script matches, and host_permissions — required for a clean Chrome
// Web Store review. Default (no env var) keeps the dev-friendly listing.
const isRelease = process.env.EXT_BUILD_MODE === 'release';

const dashboardOrigins = [
  ...(isRelease ? [] : ['http://localhost:3001/*']),
  'https://*.veloqa.com/*',
  'https://salmon-sea-0c8c28b03.7.azurestaticapps.net/*',
  'https://ambitious-wave-08351ef03.7.azurestaticapps.net/*',
];

const hostPermissions = [
  '<all_urls>',
  ...(isRelease ? [] : ['http://localhost:4000/*']),
];

export default defineManifest({
  manifest_version: 3,
  name: 'VeloCap',
  short_name: 'VeloCap',
  description: 'One-click bug capture — record screen, console, network, and user actions, then share a repro link.',
  version: '0.1.0',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'VeloCap — capture a bug',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      all_frames: false,
    },
    {
      // Runs in the page's MAIN world so we can patch console + fetch + XHR.
      // Chrome serves `.ts` files as `video/mp2t`, which breaks <script src>
      // injection, so we register this as a content script instead.
      matches: ['<all_urls>'],
      js: ['src/content/page-hook.ts'],
      run_at: 'document_start',
      all_frames: false,
      world: 'MAIN',
    },
    {
      // Auth callback script that runs on the dashboard to pick up auth tokens
      matches: dashboardOrigins,
      js: ['src/content/auth-callback.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: [
    'activeTab',
    'scripting',
    'storage',
    'tabs',
    'tabCapture',
    'desktopCapture',
    'offscreen',
    'downloads',
  ],
  host_permissions: hostPermissions,
  // Allow dashboard to send messages to the extension for Clerk auth callback
  externally_connectable: {
    matches: dashboardOrigins,
  },
  web_accessible_resources: [
    {
      // The preview page is embedded as an iframe from content-script
      // injected modals, so it must be loadable from any origin.
      // Also include offscreen assets to ensure they're accessible.
      resources: [
        'src/preview/index.html',
        'src/offscreen/index.html',
        'assets/preview*.js',
        'assets/offscreen*.js',
      ],
      matches: ['<all_urls>'],
    },
  ],
  icons: {
    '16': 'icons/icon-16.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
});
