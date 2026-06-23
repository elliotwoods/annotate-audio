import { defineConfig } from 'vitest/config';

// Vitest runs the pure logic suites (store / core / persistence). The app itself builds with
// Next.js; this config exists only so `vitest` has a home now that vite.config.ts is gone.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
