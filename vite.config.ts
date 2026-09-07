import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { analyzer } from 'vite-bundle-analyzer';
import preload from 'vite-plugin-preload';
import type { Plugin, ResolvedConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // relative, so a build can be served from any path: we deploy to /snapshot-<sha>/
  base: './',
  plugins: [preact(), preload(), injectIcons(), ...(mode === 'analyze' ? [analyzer()] : [])],
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
  },
}));

function injectIcons(): Plugin {
  const placeholder = 'INJECT_ICONS_ARRAY';
  const sources = ['src/assets/icons-ui.avif'];
  let config: ResolvedConfig;

  return {
    name: 'inject-icons',
    apply: 'build',
    enforce: 'post',
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        if (!html.includes(placeholder)) {
          throw new Error(`Could not find ${placeholder} in index.html`);
        }

        const iconUrls = sources.map((source) => {
          const asset = Object.values(context.bundle ?? {}).find(
            (output) =>
              output.type === 'asset' &&
              output.originalFileNames.some((fileName) => fileName.endsWith(source)),
          );

          if (!asset) {
            throw new Error(`Could not find emitted asset for ${source}`);
          }

          return `${config.base}${asset.fileName}`;
        });

        return html.replaceAll(placeholder, JSON.stringify(iconUrls));
      },
    },
  };
}
