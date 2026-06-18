import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each package is a project; @loom/mission-control-web carries its own jsdom vite.config.
    projects: ['packages/*'],
    passWithNoTests: true,
  },
});
