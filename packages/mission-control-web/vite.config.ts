/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The Loom Mission Control SPA. `base: './'` makes the built asset URLs relative, so the bundle
// works served from `/` by the harness server. Tailwind runs only for real builds/dev — under
// Vitest (`mode === 'test'`) it's skipped and CSS imports are no-ops, keeping component tests fast.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'test' ? [] : [tailwindcss()])],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
}));
