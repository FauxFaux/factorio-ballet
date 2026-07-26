#!/usr/bin/env node

import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import type { RawData } from 'factorio-raw-types/prototypes';
import { arr, RIngredient, RLocale, RProduct } from './raw-validators.ts';
import { resolveLocale } from './locale.ts';
import type {
  Ingredient,
  IngredientTemperature,
  Product,
  Recipe,
  ResourceId,
  StaticData,
} from '../src/types.ts';

async function main() {
  const app = process.env.APP;
  const so = resolve(app ?? '.', 'script-output');
  const read = async (p: string): Promise<unknown> =>
    JSON.parse(await fs.readFile(resolve(so, p), 'utf-8'));
  const localeFiles = await fs
    .readdir(so)
    .then((files) => files.filter((f) => f.endsWith('-locale.json')));
  const locales: Record<string, RLocale> = Object.fromEntries(
    await Promise.all(
      localeFiles.map(async (f) => [f.replace(/-locale\.json$/, ''), RLocale.parse(await read(f))]),
    ),
  );
  const v = (await read('data-raw-dump.json')) as RawData;
  const recipes = handleRecipes(v.recipe, locales);
  const resources: Record<ResourceId, { human?: string; stackSize?: number }> = {};
  for (const [itemId, item] of Object.entries(v.item)) {
    resources[`item:${itemId}`] = {
      human: resolveLocale(item.localised_name, itemId, locales, 'item'),
      stackSize: item.stack_size,
    };
  }

  for (const [fluidId, fluid] of Object.entries(v.fluid)) {
    resources[`fluid:${fluidId}`] = {
      human: resolveLocale(fluid.localised_name, fluidId, locales, 'fluid'),
    };
  }

  const staticData: StaticData = { recipes, resources };
  await fs.writeFile('static.json', JSON.stringify(staticData));
}

function handleRecipes(v: RawData['recipe'], locales: Record<string, RLocale>) {
  let hits = 0;
  const misses: Array<{ id: string; ls: unknown }> = [];

  const recipes: Record<string, Recipe> = Object.fromEntries(
    Object.entries(v).map(([id, r]) => {
      const human = resolveLocale(r.localised_name, id, locales, 'recipe');
      if (human !== undefined) {
        hits++;
      } else {
        misses.push({ id, ls: r.localised_name });
      }
      const ingredients = arr(r.ingredients ?? [])
        .map((ing) => RIngredient.parse(ing))
        .map(toIng);
      const products = arr(r.results ?? [])
        .map((res) => RProduct.parse(res))
        .map(toProd);
      const duration = r.energy_required ?? 0.5;
      return [id, { human, ingredients, products, duration }] as const;
    }),
  );

  console.log(`Hits: ${hits} / ${hits + misses.length}`);
  console.log('Miss samples:');
  for (const { id, ls } of misses.slice(0, 20)) {
    console.log(' ', id, JSON.stringify(ls));
  }
  // Show miss breakdown by localised_name shape
  const byShape: Record<string, number> = {};
  for (const { ls } of misses) {
    const shape = ls === undefined ? 'undefined' : Array.isArray(ls) ? String(ls[0]) : String(ls);
    byShape[shape] = (byShape[shape] ?? 0) + 1;
  }
  console.log('Miss shapes:', byShape);
  return recipes;
}

function toIng(game: RIngredient): Ingredient {
  return {
    resource: `${game.type}:${game.name}`,
    amount: game.amount,
    temperature: toTemp(game),
  };
}

function toTemp(game: RIngredient): IngredientTemperature | undefined {
  const f = game.temperature !== undefined;
  const i = game.minimum_temperature !== undefined;
  const a = game.maximum_temperature !== undefined;

  if (f) {
    if (i || a) throw new Error('expected only fixed');
    return { fixed: game.temperature! };
  }

  if (i && a) {
    return { min: game.minimum_temperature!, max: game.maximum_temperature! };
  }

  if (i && !a) {
    return { min: game.minimum_temperature! };
  }

  if (a && !i) {
    return { max: game.maximum_temperature! };
  }

  return undefined;
}

function toProd(game: RProduct): Product {
  return {
    resource: `${game.type}:${game.name}`,
    // TODO: bad !
    amount: game.amount ? { fixed: game.amount } : { min: game.amount_min!, max: game.amount_max! },
    probability: game.probability ?? 1,
  };
}

await main();
