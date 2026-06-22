import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative asset URLs (`base: './'`) so the built bundle works served from `/` by the replica host.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
