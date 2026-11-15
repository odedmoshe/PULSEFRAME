import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { noticesPlugin } from './notices-plugin';

const api = process.env.PF_API ?? 'http://127.0.0.1:8787';
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), noticesPlugin()],
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: false }, '/mcp': { target: api, changeOrigin: false } } },
  build: { target: 'es2023', rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), selftest: resolve(import.meta.dirname, 'selftest.html'), render: resolve(import.meta.dirname, 'render.html'), browserExport: resolve(import.meta.dirname, 'browser-export.html'), lab: resolve(import.meta.dirname, 'lab.html') } } },
});
