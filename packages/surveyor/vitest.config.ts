import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'surveyor',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
