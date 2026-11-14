import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const api = process.env.PF_API ?? 'http://127.0.0.1:8787';
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: false }, '/mcp': { target: api, changeOrigin: false } } },
  build: { target: 'es2023', rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), render: resolve(import.meta.dirname, 'render.html') } } },
});
