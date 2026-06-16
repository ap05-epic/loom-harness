import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cli',
    include: ['src/**/*.test.ts'],
    // doctor's environment check and the run.e2e walking-skeleton both launch a
    // browser; running test files sequentially avoids them contending (which
    // intermittently times out the doctor browser-launch under load).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
