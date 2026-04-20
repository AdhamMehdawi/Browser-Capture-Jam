import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'OpenJam',
  short_name: 'OpenJam',
  description: 'One-click bug capture — screenshot + console + network + device. Open-source jam.dev.',
  version: '0.1.0',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'OpenJam — capture a bug',
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
  ],
  permissions: [
    'activeTab',
    'scripting',
    'storage',
    'tabs',
    'tabCapture',
    'desktopCapture',
    'offscreen',
  ],
  host_permissions: ['<all_urls>', 'http://localhost:4000/*'],
  icons: {
    '16': 'icons/icon-16.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png',
  },
});
