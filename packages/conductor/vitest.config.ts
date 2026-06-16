import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'conductor',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
