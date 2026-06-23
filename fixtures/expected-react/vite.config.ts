import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative asset URLs (`base: './'`) so the built bundle works served from `/` by the replica host.
// In dev, proxy the legacy context path to the real backend so live-data fetches reach the same
// endpoints the JSP uses (the production replica host does the same — see serveStatic's proxy).
// Configure with LEGACY_BACKEND (e.g. http://localhost:8080) + LEGACY_CONTEXT (e.g. BAA).
const backend = process.env.LEGACY_BACKEND;
const context = process.env.LEGACY_CONTEXT ?? 'BAA';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: backend
    ? { proxy: { [`/${context}`]: { target: backend, changeOrigin: true } } }
    : undefined,
});
