import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { noticesPlugin } from './notices-plugin';

const api = process.env.PF_API ?? 'http://127.0.0.1:8787';
/** Font files are always emitted as files, never inlined as data URIs (a small woff, e.g. Karantina's Hebrew 700 at 3,780 bytes, would
 * otherwise fall under Vite's 4 KiB limit): the notices check and the export manifest pin font files, and proof:fonts F4 counts them. */
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), noticesPlugin()],
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: false }, '/mcp': { target: api, changeOrigin: false } } },
  build: { target: 'es2023', assetsInlineLimit: (file) => (FONT_FILE.test(file) ? false : undefined), rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), selftest: resolve(import.meta.dirname, 'selftest.html'), render: resolve(import.meta.dirname, 'render.html'), browserExport: resolve(import.meta.dirname, 'browser-export.html'), lab: resolve(import.meta.dirname, 'lab.html'), gpu: resolve(import.meta.dirname, 'gpu.html'), ds: resolve(import.meta.dirname, 'ds.html') } } },
});
