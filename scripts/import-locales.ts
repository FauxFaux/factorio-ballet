#!/usr/bin/env tsx

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const [, , scriptOutput, ...rest] = process.argv;
  if (!scriptOutput || rest.length) {
    console.error('usage: import-locales <script-output>');
    process.exit(1);
  }

  const locales: Record<string, unknown> = {};

  for (const entry of await readdir(scriptOutput)) {
    if (!entry.endsWith('-locale.json')) continue;
    const kind = entry.slice(0, -12);
    locales[kind] = JSON.parse(
      await readFile(resolve(scriptOutput, entry), 'utf-8'),
    );
  }

  await writeFile(
    'public/sets/space-age/locales.json',
    JSON.stringify(locales),
    'utf-8',
  );
}

await main();
