import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'browser',
    include: ['src/**/*.test.ts'],
    // Browser-dependent integration tests can be slow on first launch.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
