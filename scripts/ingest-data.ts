#!/usr/bin/env node

import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import type { RawData } from 'factorio-raw-types/prototypes';
import { arr, RIngredient, RProduct } from './raw-validators.ts';
import type { Ingredient, IngredientTemperature, Product, Recipe } from '../src/types.ts';

async function main() {
  const app = process.env.APP;
  const so = resolve(app ?? '.', 'script-output');
  const read = async (p: string): Promise<unknown> =>
    JSON.parse(await fs.readFile(resolve(so, p), 'utf-8'));
  const rl = await read('recipe-locale.json');
  console.log(rl.names);
  const v = (await read('data-raw-dump.json')) as RawData;
  const recipes: Record<string, Recipe> = Object.fromEntries(
    Object.entries(v.recipe).map(([id, r]) => {
      console.log(r.localised_name);
      const ingredients = arr(r.ingredients ?? [])
        .map((ing) => RIngredient.parse(ing))
        .map(toIng);
      const products = arr(r.results ?? [])
        .map((res) => RProduct.parse(res))
        .map(toProd);
      return [id, { ingredients, products, duration: r.energy_required ?? 0.5 }] as const;
    }),
  );

  for (const [id, recipe] of Object.entries(recipes)) {
    // console.log(id, recipe);
  }
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
