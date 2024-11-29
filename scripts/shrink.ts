#!/usr/bin/env tsx

import { type RawData } from 'factorio-raw-types/prototypes';
import { readFile, writeFile } from 'node:fs/promises';
import { _pick } from '~/lib/dash';
import {
  type Recipe,
  type Shrunk,
  recpKeys,
  itemKeys,
  Item,
  craftingKeys,
  Crafting,
} from '~/lib/shrunk';

async function main() {
  const [, , rawPath, ...rest] = process.argv;
  if (!rawPath || rest.length) {
    console.error('usage: shrink <raw-data.json>');
    process.exit(1);
  }

  const orig = JSON.parse(await readFile(rawPath, 'utf-8')) as RawData;

  const items: Record<string, Item> = {};
  for (const item of Object.values(orig.item)) {
    items[item.name] = _pick(item, itemKeys);
  }

  const recipes: Record<string, Recipe> = {};
  for (const recp of Object.values(orig.recipe)) {
    const cand = _pick(recp, recpKeys);

    for (const key of recpKeys) {
      // I think this is mostly them trying to convey "null" (empty list) from lua
      if (JSON.stringify(cand[key]) === '{}') {
        delete cand[key];
      }
    }

    recipes[recp.name] = cand;
  }

  const crafting: Record<string, Crafting> = {};
  for (const craft of Object.values(orig['assembling-machine']).concat(
    Object.values(orig['furnace']),
  )) {
    crafting[craft.name] = _pick(craft, craftingKeys);
  }

  const shrunk: Shrunk = { items, recipes, crafting };

  await writeFile(
    'public/assets/sets/space-age/shrunk-data.json',
    JSON.stringify(shrunk),
    'utf-8',
  );
}

await main();
