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

/**
 * `data.raw` splits items over one key per subtype, so a recipe's `type: "item"` reference may
 * resolve to any of these. They all extend `ItemPrototype`, hence share `stack_size` / `hidden`.
 */
const ITEM_KEYS = [
  'ammo',
  'armor',
  'blueprint',
  'blueprint-book',
  'capsule',
  'copy-paste-tool',
  'deconstruction-item',
  'gun',
  'item',
  'item-with-entity-data',
  'item-with-inventory',
  'item-with-label',
  'item-with-tags',
  'module',
  'rail-planner',
  'repair-tool',
  'selection-tool',
  'space-platform-starter-pack',
  'spidertron-remote',
  'tool',
  'upgrade-item',
] as const satisfies ReadonlyArray<keyof RawData>;

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

  // Mods disable content by setting `hidden` on the prototype rather than deleting it (e.g. Angel's
  // `functions.hide` / `OV.disable_recipe`), so hidden entries are dead but still in the dump. A
  // handful of hidden items are nonetheless live because surviving recipes reference them (the
  // angels void sinks, `rocket-part`), so keep anything a surviving recipe mentions.
  const referenced = new Set<ResourceId>();
  for (const recipe of Object.values(recipes)) {
    for (const { resource } of recipe.ingredients) referenced.add(resource);
    for (const { resource } of recipe.products) referenced.add(resource);
  }

  const resources: Record<ResourceId, { human?: string; stackSize?: number }> = {};
  let dropped = 0;
  for (const key of ITEM_KEYS) {
    for (const [itemId, item] of Object.entries(v[key] ?? {})) {
      const id = `item:${itemId}` as const;
      if ((item.hidden || item.parameter) && !referenced.has(id)) {
        dropped++;
        continue;
      }
      // every item subtype shares the `item-name.` locale namespace
      resources[id] = {
        human: resolveLocale(item.localised_name, itemId, locales, 'item'),
        stackSize: item.stack_size,
      };
    }
  }

  for (const [fluidId, fluid] of Object.entries(v.fluid)) {
    const id = `fluid:${fluidId}` as const;
    if (fluid.hidden && !referenced.has(id)) {
      dropped++;
      continue;
    }
    resources[id] = {
      human: resolveLocale(fluid.localised_name, fluidId, locales, 'fluid'),
    };
  }
  console.log(`Resources: ${Object.keys(resources).length} (dropped ${dropped} hidden/parameter)`);

  // A recipe referencing a resource we never emitted means ITEM_KEYS is missing a subtype.
  const dangling = new Set<ResourceId>();
  for (const id of referenced) {
    if (!(id in resources)) dangling.add(id);
  }
  if (dangling.size > 0) {
    console.log(`Dangling resource refs: ${dangling.size}`, [...dangling].slice(0, 20));
  }

  const staticData: StaticData = { recipes, resources };
  await fs.writeFile('static.json', JSON.stringify(staticData));
}

function handleRecipes(v: RawData['recipe'], locales: Record<string, RLocale>) {
  let hits = 0;
  const misses: Array<{ id: string; ls: unknown }> = [];

  let skipped = 0;

  const recipes: Record<string, Recipe> = Object.fromEntries(
    Object.entries(v)
      .filter(([, r]) => {
        // `hidden` is how mods disable a recipe without deleting it; `parameter` marks the
        // blueprint-parameter placeholders, which have no ingredients or results at all.
        if (!r.hidden && !r.parameter) return true;
        skipped++;
        return false;
      })
      .map(([id, r]) => {
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

  console.log(`Recipes: ${Object.keys(recipes).length} (dropped ${skipped} hidden/parameter)`);
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
