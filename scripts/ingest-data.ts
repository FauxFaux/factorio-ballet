#!/usr/bin/env node

import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import type { RawData } from 'factorio-raw-types/prototypes';
import { ITEM_KEYS } from './raw-keys.ts';
import { arr, RIngredient, RLocale, RProduct } from './raw-validators.ts';
import { resolveLocale } from './locale.ts';
import { entriesOf } from '../src/ts.ts';
import { analyse } from './complexity.ts';
import { placingItems, syntheticRecipes } from './synthetic.ts';
import type {
  Ingredient,
  IngredientTemperature,
  Machine,
  MachineKind,
  Product,
  Recipe,
  Resource,
  ResourceId,
  StaticData,
} from '../src/types.ts';

/**
 * Everything with `crafting_categories`, i.e. everything which can run a recipe. `character` is
 * hand crafting, and the only thing covering the mods' manual-only categories. `god-controller`
 * is the editor's, and is not a real production option.
 */
const MACHINE_KEYS = [
  'assembling-machine',
  'furnace',
  'rocket-silo',
  'character',
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
      localeFiles.map(async (f): Promise<[string, RLocale]> => [
        f.replace(/-locale\.json$/, ''),
        RLocale.parse(await read(f)),
      ]),
    ),
  );
  const v = (await read('data-raw-dump.json')) as RawData;
  const recipes = handleRecipes(v.recipe, locales);
  const machines = handleMachines(v, locales);
  addSynthetic(v, recipes, machines, locales);

  // Mods disable content by setting `hidden` on the prototype rather than deleting it (e.g. Angel's
  // `functions.hide` / `OV.disable_recipe`), so hidden entries are dead but still in the dump. A
  // handful of hidden items are nonetheless live because surviving recipes reference them (the
  // angels void sinks, `rocket-part`), so keep anything a surviving recipe mentions.
  const referenced = new Set<ResourceId>();
  for (const recipe of Object.values(recipes)) {
    for (const { resource } of recipe.ingredients) referenced.add(resource);
    for (const { resource } of recipe.products) referenced.add(resource);
  }

  const resources: Record<ResourceId, Resource> = {};
  let dropped = 0;
  for (const key of ITEM_KEYS) {
    for (const [itemId, item] of entriesOf(v[key] ?? {})) {
      const id = `item:${itemId}` as const;
      if ((item.hidden || item.parameter) && !referenced.has(id)) {
        dropped++;
        continue;
      }
      // every item subtype shares the `item-name.` locale namespace
      resources[id] = {
        human: resolveLocale(itemId, locales, 'item'),
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
      human: resolveLocale(fluidId, locales, 'fluid'),
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

  // Every category a live recipe names should be craftable somewhere; anything left over means we
  // have dropped a machine we should have kept (or kept a recipe we should have dropped).
  const craftable = new Set(Object.values(machines).flatMap((m) => m.categories));
  const homeless = new Set(
    Object.values(recipes)
      .flatMap((r) => r.categories)
      .filter((c) => !craftable.has(c)),
  );
  if (homeless.size > 0) {
    console.log(`Recipe categories with no machine: ${homeless.size}`, [...homeless].slice(0, 20));
  }

  applyComplexity(v, recipes, resources);

  const staticData: StaticData = { recipes, resources, machines };
  await fs.writeFile('static.json', JSON.stringify(staticData));
}

/**
 * How far through the tech tree each recipe and resource sits, from `scripts/complexity.ts`; see
 * `Recipe.complexity`. Rounded hard, because four decimals is already finer than the model is
 * meaningful to, and the field lands on every one of ~7000 entries.
 */
function applyComplexity(
  v: RawData,
  recipes: Record<string, Recipe>,
  resources: Record<ResourceId, Resource>,
) {
  const { progress, recipeProgress } = analyse(v);
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  let unreachable = 0;

  for (const [id, recipe] of Object.entries(recipes)) {
    const p = recipeProgress.get(id);
    if (p === undefined) unreachable++;
    else recipe.complexity = round(p);
  }
  for (const [id, resource] of Object.entries(resources) as [ResourceId, Resource][]) {
    const p = progress.get(id);
    if (p === undefined) unreachable++;
    else resource.complexity = round(p);
  }

  console.log(`Complexity: ${unreachable} recipes/resources have no route to them`);
}

/**
 * The sources which are not recipes — offshore pumps and mining drills — folded in as recipes and
 * machines like any other, and flagged `synthetic` so the UI can distinguish them. See
 * `scripts/synthetic.ts` for what they are and where the rates come from; `scripts/complexity.ts`
 * builds the same set, which is why the two agree on ids.
 *
 * The machines are new entries here rather than in `handleMachines`: a drill has no
 * `crafting_categories`, so its only categories are the ones the synthetic recipes invent, and a
 * drill covering several resource categories accumulates one per recipe it can run.
 */
function addSynthetic(
  v: RawData,
  recipes: Record<string, Recipe>,
  machines: Record<string, Machine>,
  locales: Record<string, RLocale>,
) {
  const synthetic = syntheticRecipes(v);
  const added = new Set<string>();

  for (const s of synthetic) {
    recipes[s.id] = {
      // trimmed: a couple of Angel's names carry a trailing space ("Infinite rubyte ")
      human:
        `${s.name.verb} ${resolveLocale(s.name.source, locales, s.name.locale) ?? s.name.source}`.trim(),
      ingredients: s.ingredients.map(toIng),
      products: s.products.map(toProd),
      duration: s.duration,
      categories: [s.category],
      synthetic: true,
    };

    for (const m of s.machines) {
      const known = machines[m.id];
      if (known) {
        if (!known.categories.includes(s.category)) known.categories.push(s.category);
        continue;
      }
      added.add(m.id);
      machines[m.id] = {
        human: resolveLocale(m.id, locales, 'entity'),
        kind: m.kind,
        item: m.item,
        categories: [s.category],
        speed: m.speed,
        moduleSlots: m.moduleSlots,
      };
    }
  }

  console.log(`Synthetic: ${synthetic.length} recipes over ${added.size} machines`);
}

function handleRecipes(v: RawData['recipe'], locales: Record<string, RLocale>) {
  const unnamed: string[] = [];
  let skipped = 0;
  let productive = 0;

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
        const human = resolveLocale(id, locales, 'recipe');
        if (human === undefined) unnamed.push(id);
        const ingredients = arr(r.ingredients ?? [])
          .map((ing) => RIngredient.parse(ing))
          .map(toIng);
        const products = arr(r.results ?? [])
          .map((res) => RProduct.parse(res))
          .map(toProd);
        const duration = r.energy_required ?? 0.5;
        // `crafting` is the game's default for a recipe which names no category.
        const categories = [r.category ?? 'crafting', ...(r.additional_categories ?? [])];
        // Off by default in the game, and set explicitly false by 17 live recipes here, so the
        // absent case and the false case mean the same thing; emit the flag only when it is on.
        const allowProductivity = r.allow_productivity ? (true as const) : undefined;
        if (allowProductivity) productive++;
        return [
          id,
          { human, ingredients, products, duration, categories, allowProductivity },
        ] as const;
      }),
  );

  console.log(
    `Recipes: ${Object.keys(recipes).length} (dropped ${skipped} hidden/parameter),` +
      ` ${productive} allowing productivity`,
  );
  if (unnamed.length > 0) {
    console.log(`Unnamed recipes: ${unnamed.length}`, unnamed.slice(0, 20));
  }
  return recipes;
}

/**
 * The crafting machines, keyed by prototype id. As with recipes, `hidden` is how the mods disable a
 * machine without deleting it; dropping those leaves every live recipe's category still covered.
 */
function handleMachines(v: RawData, locales: Record<string, RLocale>) {
  const machines: Record<string, Machine> = {};
  const placedBy = placingItems(v);
  let skipped = 0;

  for (const key of MACHINE_KEYS) {
    for (const [id, m] of entriesOf(v[key] ?? {})) {
      if (m.hidden) {
        skipped++;
        continue;
      }
      machines[id] = {
        human: resolveLocale(id, locales, 'entity'),
        kind: key satisfies MachineKind,
        item: placedBy.get(id),
        categories: m.crafting_categories ?? [],
        // the character has no `crafting_speed`; hand crafting runs at the recipe's stated time
        speed: 'crafting_speed' in m ? (m.crafting_speed ?? 1) : 1,
        moduleSlots: 'module_slots' in m ? m.module_slots : undefined,
      };
    }
  }

  console.log(`Machines: ${Object.keys(machines).length} (dropped ${skipped} hidden)`);
  return machines;
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
