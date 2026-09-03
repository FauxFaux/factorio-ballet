import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { analyzer } from 'vite-bundle-analyzer';
import preload from 'vite-plugin-preload';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // relative, so a build can be served from any path: we deploy to /snapshot-<sha>/
  base: './',
  plugins: [preact(), preload(), ...(mode === 'analyze' ? [analyzer()] : [])],
  test: {
    include: ['test/**/*.test.ts'],
  },
}));
