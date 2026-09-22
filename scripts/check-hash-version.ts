#!/usr/bin/env node

import * as fs from 'node:fs/promises';

const HASH_VERSION = /export const HASH_VERSION = `([^`]+)`;/;

function fingerprint(...idTables: Record<string, unknown>[]): string {
  // FNV-1a, matching the ids and their order in pack.ts.
  let hash = 0x811c9dc5;
  for (const ids of idTables) {
    for (const id of Object.keys(ids)) {
      for (let i = 0; i < id.length; i++) {
        hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
      }
      hash = Math.imul(hash ^ 0x1f, 0x01000193);
    }
  }
  return (hash >>> 0).toString(36).padStart(3, '0').slice(-3);
}

async function main() {
  const [urlHandler, staticData, staticRecipes] = await Promise.all([
    fs.readFile('src/boot/url-handler.tsx', 'utf8'),
    fs.readFile('src/assets/static.json', 'utf8'),
    fs.readFile('src/assets/static-recipes.json', 'utf8'),
  ]);
  const hashVersion = HASH_VERSION.exec(urlHandler)?.[1];
  if (!hashVersion) throw new Error('Could not find HASH_VERSION in src/boot/url-handler.tsx');

  const data = JSON.parse(staticData) as {
    machines: Record<string, unknown>;
    modules: Record<string, unknown>;
  };
  const recipes = JSON.parse(staticRecipes) as { recipes: Record<string, unknown> };
  const expectedFingerprint = fingerprint(recipes.recipes, data.machines, data.modules);
  if (!hashVersion.endsWith(expectedFingerprint)) {
    throw new Error(
      `HASH_VERSION ${hashVersion} does not end with the dataset fingerprint ${expectedFingerprint}`,
    );
  }
}

await main();
