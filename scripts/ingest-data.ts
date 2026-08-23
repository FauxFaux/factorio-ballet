#!/usr/bin/env node

import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import type { RawData } from 'factorio-raw-types/prototypes';
import { BELT_KEYS, ITEM_KEYS } from './raw-keys.ts';
import { arr, effectLimits, isProduced, RIngredient, RLocale, RProduct } from './raw-validators.ts';
import { resolveLocale } from './locale.ts';
import { entriesOf } from '../src/ts.ts';
import { analyse } from './complexity.ts';
import { placingItems, syntheticRecipes } from './synthetic.ts';
import type {
  Beacon,
  Belt,
  Ingredient,
  IngredientTemperature,
  Machine,
  MachineKind,
  Module,
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
  const modules = handleModules(v);
  const beacons = handleBeacons(v, locales);
  const belts = handleBelts(v, locales);

  // Mods disable content by setting `hidden` on the prototype rather than deleting it (e.g. Angel's
  // `functions.hide` / `OV.disable_recipe`), so hidden entries are dead but still in the dump. A
  // handful of hidden items are nonetheless live because surviving recipes reference them
  // (`rocket-part`), so keep anything a surviving recipe mentions. The void markers used to be
  // kept by this too, until `isProduced` stopped counting a never-rolled result as a reference.
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

  checkModules(modules, machines, resources);
  checkBeacons(beacons, v);
  checkBelts(belts, v, resources);
  checkCatalysts(recipes);

  const sciencePacks = applyComplexity(v, recipes, resources);

  const staticData: StaticData = {
    recipes,
    resources,
    machines,
    modules,
    beacons,
    belts,
    sciencePacks,
  };
  await fs.writeFile('static.json', JSON.stringify(staticData));
}

/**
 * How far through the tech tree each recipe and resource sits, from `scripts/complexity.ts`; see
 * `Recipe.complexity`. Rounded hard, because four decimals is already finer than the model is
 * meaningful to, and the field lands on every one of ~7000 entries.
 *
 * Returns the science packs the same walk found, for `StaticData.sciencePacks`.
 */
function applyComplexity(
  v: RawData,
  recipes: Record<string, Recipe>,
  resources: Record<ResourceId, Resource>,
): ResourceId[] {
  const { progress, recipeProgress, packs } = analyse(v);
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
  console.log(
    `Science packs: ${packs.length}`,
    packs.map((id) => resources[id]?.human ?? id),
  );
  return packs;
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
        allowedEffects: m.allowedEffects,
        allowedModuleCategories: m.allowedModuleCategories,
      };
    }
  }

  console.log(`Synthetic: ${synthetic.length} recipes over ${added.size} machines`);
}

function handleRecipes(v: RawData['recipe'], locales: Record<string, RLocale>) {
  const unnamed: string[] = [];
  let skipped = 0;
  let productive = 0;
  let voided = 0;

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
          .filter((res) => {
            if (isProduced(res)) return true;
            voided++;
            return false;
          })
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

  const catalysed = Object.values(recipes).flatMap((r) =>
    r.products.filter((p) => p.ignoredByProductivity),
  ).length;
  console.log(
    `Recipes: ${Object.keys(recipes).length} (dropped ${skipped} hidden/parameter),` +
      ` ${productive} allowing productivity, ${voided} results which are never produced,` +
      ` ${catalysed} results part catalyst`,
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
        // both absent-means-everything; see `Machine.allowedEffects`
        allowedEffects: 'allowed_effects' in m ? effectLimits(m.allowed_effects) : undefined,
        allowedModuleCategories:
          'allowed_module_categories' in m ? m.allowed_module_categories : undefined,
      };
    }
  }

  console.log(`Machines: ${Object.keys(machines).length} (dropped ${skipped} hidden)`);
  return machines;
}

/**
 * The modules, keyed by prototype id — which is also the id of the item, since a module *is* an
 * item and is already in `resources` with its name, icon and complexity.
 *
 * Only the ones which change throughput are kept: a module with neither a speed nor a productivity
 * effect is an efficiency or pollution module, and this app models neither power nor smoke, so
 * carrying it would be offering the user a choice with no consequence. Of the effects we do keep,
 * `consumption`, `pollution` and `quality` go the same way.
 *
 * Effect values arrive with the float noise of the mod's own arithmetic (speed module 2 is
 * `0.30000000000000004`), so they are rounded like every other number here.
 */
function handleModules(v: RawData): Record<string, Module> {
  const modules: Record<string, Module> = {};
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  let skipped = 0;

  for (const [id, m] of Object.entries(v.module)) {
    // consistent with everything else, though no module in this pack is hidden
    if (m.hidden) {
      skipped++;
      continue;
    }
    const speed = m.effect?.speed;
    const productivity = m.effect?.productivity;
    if (!speed && !productivity) {
      skipped++;
      continue;
    }
    modules[id] = {
      category: m.category,
      tier: m.tier,
      speed: speed === undefined ? undefined : round(speed),
      productivity: productivity === undefined ? undefined : round(productivity),
    };
  }

  console.log(
    `Modules: ${Object.keys(modules).length}` +
      ` (dropped ${skipped} with no speed or productivity effect)`,
  );
  return modules;
}

/**
 * The beacons, keyed by prototype id. A beacon runs no recipes — it has no `crafting_categories` at
 * all — so it is not a `Machine`, and the two numbers which make it worth ingesting are the module
 * slots and the `distribution_effectivity`. Hidden is dropped, as everywhere else.
 */
function handleBeacons(v: RawData, locales: Record<string, RLocale>): Record<string, Beacon> {
  const beacons: Record<string, Beacon> = {};
  const placedBy = placingItems(v);
  let skipped = 0;

  for (const [id, b] of Object.entries(v.beacon ?? {})) {
    if (b.hidden) {
      skipped++;
      continue;
    }
    beacons[id] = {
      human: resolveLocale(id, locales, 'entity'),
      item: placedBy.get(id),
      moduleSlots: b.module_slots,
      distributionEffectivity: b.distribution_effectivity,
      // both absent-means-everything, as on a machine; see `Machine.allowedEffects`
      allowedEffects: effectLimits(b.allowed_effects),
      allowedModuleCategories: b.allowed_module_categories,
    };
  }

  console.log(`Beacons: ${Object.keys(beacons).length} (dropped ${skipped} hidden)`);
  return beacons;
}

/**
 * Whether the app is entitled to the `dist / sqrt(n)` formula it applies to beacons.
 *
 * 2.0 does not compute that: it looks the penalty up in the beacon's `profile`, a list whose `n`th
 * entry is what each of `n` beacons transmits. The square root is what the vanilla profile happens
 * to contain, and `docs/beacons.wiki` documents the game in those terms, so `speedBoost` uses the
 * formula and this checks the dump agrees rather than ingesting 100 numbers per beacon to
 * interpolate. A beacon with a flatter profile — a mod could ship one, and quality items already
 * lengthen the list — would be transmitting less than we would quote, so the failure is loud.
 *
 * A beacon with no profile at all is the game's own default, which is the same square root.
 */
function checkBeacons(beacons: Record<string, Beacon>, v: RawData) {
  const off: string[] = [];
  for (const id of Object.keys(beacons)) {
    const profile = v.beacon[id]?.profile;
    if (!profile) continue;
    for (const [i, share] of profile.entries()) {
      if (Math.abs(share - 1 / Math.sqrt(i + 1)) > 5e-4) off.push(`${id}[${i + 1}]=${share}`);
    }
  }
  if (off.length > 0) {
    console.log(`Beacon profiles which are not 1/sqrt(n): ${off.length}`, off.slice(0, 20));
  }
}

/**
 * Ticks per second, and how many items fit along a tile of one lane: the game states a belt's
 * `speed` in tiles per tick, and the app wants items per second. An item occupies a quarter of a
 * tile along the lane it is on, and a belt has two of them.
 */
const TICKS_PER_SECOND = 60;
const ITEMS_PER_TILE = 4;
const BELT_LANES = 2;

/**
 * The transport belts, keyed by prototype id. Undergrounds, splitters, loaders and linked belts are
 * `speed` too, and are deliberately not here: they are the same tier's number written out again
 * (see `checkBelts`), and none of them is a thing a plan is measured against.
 *
 * Hidden is dropped as everywhere else, though no transport belt in this pack is hidden — the
 * hidden belt-shaped prototypes are the three vanilla loaders and the two script-only entities
 * (`linked-belt`, `lane-splitter`), which are not transport belts to begin with.
 */
function handleBelts(v: RawData, locales: Record<string, RLocale>): Record<string, Belt> {
  const belts: Record<string, Belt> = {};
  const placedBy = placingItems(v);
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  let skipped = 0;

  for (const [id, b] of Object.entries(v['transport-belt'] ?? {})) {
    if (b.hidden) {
      skipped++;
      continue;
    }
    belts[id] = {
      human: resolveLocale(id, locales, 'entity'),
      item: placedBy.get(id),
      itemsPerSecond: round(b.speed * TICKS_PER_SECOND * ITEMS_PER_TILE * BELT_LANES),
    };
  }

  console.log(`Belts: ${Object.keys(belts).length} (dropped ${skipped} hidden)`);
  return belts;
}

/**
 * The two things ingesting only `transport-belt` assumes.
 *
 * A belt with no placing item would be half a building, as an unplaceable pump is in
 * `scripts/synthetic.ts` — and it would have no name, icon or complexity either, since all three
 * live on the item. None here: every belt is placed by an item of its own id.
 *
 * The other is that a tier is one number. `underground-belt`, `splitter`, `loader`, `loader-1x1`,
 * `linked-belt` and `lane-splitter` each state their own `speed`, and a pack could make a splitter
 * slower than the belt feeding it — 2.0's own lane splitter is the shape of a prototype that might.
 * Every one of the 25 here matches a belt exactly, so quoting the belt covers the line; a report
 * from this means throughput has a second number and `Belt` needs revisiting.
 */
function checkBelts(
  belts: Record<string, Belt>,
  v: RawData,
  resources: Record<ResourceId, Resource>,
) {
  const itemless = Object.entries(belts).filter(
    ([, b]) => b.item === undefined || !(`item:${b.item}` in resources),
  );
  if (itemless.length > 0) {
    console.log(`Belts with no item: ${itemless.length}`, itemless.map(([id]) => id).slice(0, 20));
  }

  const speeds = new Set(Object.values(v['transport-belt'] ?? {}).map((b) => b.speed));
  const odd: string[] = [];
  for (const key of BELT_KEYS) {
    for (const [id, b] of entriesOf(v[key] ?? {})) {
      if (!speeds.has(b.speed)) odd.push(`${id}=${b.speed}`);
    }
  }
  if (odd.length > 0) {
    console.log(`Belt-shaped entities running at no belt's speed: ${odd.length}`, odd.slice(0, 20));
  }
}

/**
 * The two cross-references modules introduce, as numbers rather than as a blank dropdown later.
 *
 * A module with no item means `ITEM_KEYS` lost `module`, or the hidden filter ate one. A module no
 * machine will take means the reading of `allowed_module_categories` is wrong — the field is a
 * whitelist and *absent* means all, which is the whole reason Angel's bio-yield modules have
 * somewhere to go: no machine's list names their category, and the twelve farms name no list.
 */
function checkModules(
  modules: Record<string, Module>,
  machines: Record<string, Machine>,
  resources: Record<ResourceId, Resource>,
) {
  const itemless = Object.keys(modules).filter((id) => !(`item:${id}` in resources));
  if (itemless.length > 0) {
    console.log(`Modules with no item: ${itemless.length}`, itemless.slice(0, 20));
  }

  const slotted = Object.values(machines).filter((m) => (m.moduleSlots ?? 0) > 0);
  const homeless = Object.entries(modules).filter(
    ([, module]) =>
      !slotted.some((m) => m.allowedModuleCategories?.includes(module.category) ?? true),
  );
  if (homeless.length > 0) {
    console.log(
      `Modules no machine will take: ${homeless.length}`,
      homeless.map(([id]) => id).slice(0, 20),
    );
  }
}

/**
 * Whether `ignored_by_productivity` can be trusted to state the catalysts by itself.
 *
 * It cannot be taken on faith, because the 1.1 game did not work this way: in the `raw-110` sample,
 * `coal-liquefaction` and `kovarex-enrichment-process` — the textbook catalyst recipes, where the
 * game demonstrably pays no productivity on the 40 uranium-235 handed back — carry no
 * `catalyst_amount` at all. 1.1's engine derived it from the ingredients, so a data-stage dump said
 * nothing and a calculator had to work it out itself. 2.0 renamed the field and, as far as this
 * pack shows, made it explicit: the same two recipes now state 25 and 40. That is a convention of
 * the recipes, not a guarantee of the format, so it is checked rather than assumed.
 *
 * The check is the one case which would silently overstate throughput: a product which is also an
 * ingredient, on a recipe which allows productivity, either not stating a catalyst share or
 * stating one which is not `min(in, out)`. Anything reported here means `productAmount` is paying a
 * bonus the game does not, and the fix is to derive the share in {@link toProd} — this is the
 * evidence that would justify it. Pairs on recipes which disallow productivity are counted only:
 * nothing pays a bonus there, so what the field says cannot matter.
 */
function checkCatalysts(recipes: Record<string, Recipe>) {
  const suspect: string[] = [];
  let checked = 0;
  let moot = 0;

  for (const [id, recipe] of Object.entries(recipes)) {
    const ingredients = new Map(recipe.ingredients.map((i) => [i.resource, i.amount]));
    for (const product of recipe.products) {
      const taken = ingredients.get(product.resource);
      if (taken === undefined) continue;
      if (!recipe.allowProductivity) {
        moot++;
        continue;
      }
      checked++;
      // the most a roll could hand back, so a `{min,max}` result is not flagged for a share which
      // only some rolls could cover: four of the pairs here are fish, 2 in and 5–10 out
      const made = 'fixed' in product.amount ? product.amount.fixed : product.amount.max;
      const expected = Math.min(taken, made);
      if (product.ignoredByProductivity !== expected) {
        suspect.push(`${id}/${product.resource} (${product.ignoredByProductivity} ≠ ${expected})`);
      }
    }
  }

  console.log(
    `Catalysts: ${checked} product-also-ingredient pairs where productivity applies,` +
      ` ${suspect.length} not stating min(in, out); ${moot} more where productivity cannot apply`,
  );
  if (suspect.length > 0) {
    console.log(
      'A catalyst share the recipe does not state: productivity is being overpaid on these,' +
        ' and `toProd` should be deriving it. See `checkCatalysts`.',
      suspect.slice(0, 20),
    );
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
    // the catalyst share, which zero is not: see `Product.ignoredByProductivity`
    ignoredByProductivity: game.ignored_by_productivity || undefined,
  };
}

await main();
