import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// https://vite.dev/config/
export default defineConfig({
  // relative, so a build can be served from any path: we deploy to /snapshot-<sha>/
  base: './',
  plugins: [preact()],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
