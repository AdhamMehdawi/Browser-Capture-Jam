import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config.js';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // crxjs picks up popup/content/background from the manifest; the
        // offscreen + permissions pages are not manifest-declared, so we
        // pass them here.
        offscreen: 'src/offscreen/index.html',
        permissions: 'src/permissions/index.html',
        'permissions-screen': 'src/permissions/screen.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
