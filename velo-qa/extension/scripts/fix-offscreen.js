#!/usr/bin/env node
/**
 * Post-build script to fix the offscreen document.
 *
 * The vite build outputs the offscreen HTML with module imports that don't
 * work reliably in Chrome extension offscreen documents. This script rewrites
 * the HTML to use a classic script tag pointing to the bundled JS file.
 *
 * Chrome extension CSP doesn't allow inline scripts, so we keep it external.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const offscreenHtml = path.join(distDir, 'src', 'offscreen', 'index.html');
const assetsDir = path.join(distDir, 'assets');

// Find the offscreen JS file
const files = fs.readdirSync(assetsDir);
const offscreenJs = files.find(f => f.startsWith('offscreen-') && f.endsWith('.js'));

if (!offscreenJs) {
  console.error('[fix-offscreen] Could not find offscreen JS file');
  process.exit(1);
}

// Read the JS content and remove any modulepreload import (may appear mid-line)
let jsContent = fs.readFileSync(path.join(assetsDir, offscreenJs), 'utf8');
jsContent = jsContent.replace(/import"[^"]*modulepreload[^"]*\.js";?/g, '');

// Write the fixed JS file (overwrite the original)
fs.writeFileSync(path.join(assetsDir, offscreenJs), jsContent);

// Create new HTML with a classic script tag (not module - module scripts are async
// and may cause timing issues with Chrome's offscreen document lifecycle)
// Use a path relative to the HTML file location (src/offscreen/index.html -> ../../assets/offscreen-xxx.js)
const newHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Velo QA Recorder</title>
  </head>
  <body>
    <script src="../../assets/${offscreenJs}"></script>
  </body>
</html>
`;

fs.writeFileSync(offscreenHtml, newHtml);
console.log('[fix-offscreen] Fixed offscreen document with external script:', offscreenJs);
