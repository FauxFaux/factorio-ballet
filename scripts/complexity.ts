#!/usr/bin/env node

/**
 * How far through the game are you when you can first make a thing?
 *
 * The idea, lifted from `../factorio-raw-types/scripts/tech-counter.ts`: walk a technology's
 * prerequisites and add up the science packs. That gives a vector (`{automation: 2000, logistic:
 * 400, ...iron pla}`) rather than a number, so the missing piece is what one pack of each kind is worth.
 *
 * We derive that from the tree itself: **a science pack is worth all the science already spent to
 * unlock it**, with automation science as the unit. So logistic science is worth 676 (the 675
 * automation science its own technology costs, plus one), chemical is worth 1.27M, and so on. That
 * is circular — a technology's cost is denominated in packs — but the dependency graph *of packs*
 * is acyclic, so iterating to a fixed point resolves it in five passes.
 *
 * The weights come out exponential, which matches how the game actually feels: 2000 automation
 * science is a rounding error next to 400 logistic. Taking a log at the end turns that back into
 * something linear enough to read as a percentage.
 *
 * A resource's cost is then the cheapest way to actually have one: over every recipe producing it,
 * the max of that recipe's unlock cost and each ingredient's own cost — a minimax shortest path.
 * The max is the point: a recipe unlocked at 10% whose ingredient only exists at 60% is a 60%
 * recipe.
 *
 * ```bash
 * APP=~/ins/factorio-2-73-ab node scripts/complexity.ts            # landmark report
 * APP=~/ins/factorio-2-73-ab node scripts/complexity.ts plastic    # everything matching
 * APP=~/ins/factorio-2-73-ab node scripts/complexity.ts --tech     # technologies, not resources
 * ```
 */

import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import type {
  EntityPrototype,
  EntityWithHealthPrototype,
  ItemPrototype,
  RawData,
  TechnologyPrototype,
} from 'factorio-raw-types/prototypes';
import { ITEM_KEYS } from './raw-keys.ts';
import { arr, RIngredient, RLocale, RProduct } from './raw-validators.ts';
import { resolveLocale } from './locale.ts';
import type { ResourceId } from '../src/types.ts';

/** The unit of account: everything else is priced in automation science packs. */
const UNIT_PACK = 'automation-science-pack';

/**
 * Prototype types the map generator places, whose `minable` results you therefore get for free:
 * ores, trees (Angel's gardens are trees), fish, rocks. Deliberately not every `minable` — most
 * things with a `minable` are buildings, and "mine the assembler you placed" is not a source.
 */
const NATURAL_KEYS = [
  'tree',
  'fish',
  'simple-entity',
  'resource',
  'cliff',
  'plant',
] as const satisfies ReadonlyArray<keyof RawData>;

/** Prototype types whose `loot` drops when you kill one: bob's alien artifacts. */
const LOOT_KEYS = ['unit', 'turret', 'unit-spawner'] as const satisfies ReadonlyArray<
  keyof RawData
>;

/**
 * Ingredients, products and `minable` results all carry the game's own `type` discriminant, which
 * is exactly the left half of a `ResourceId` — so this needs no assertion.
 */
const rid = (x: { type: 'item' | 'fluid'; name: string }): ResourceId => `${x.type}:${x.name}`;

interface Rec {
  /** available without research */
  free: boolean;
  /** not a real recipe: a rocket launch or a fuel cell burning down */
  synthetic?: boolean;
  ingredients: ResourceId[];
  products: ResourceId[];
}

export interface Complexity {
  /** 0 at the crash site, 1 for the most gated thing in the pack */
  progress: number;
  /** raw weighted science cost, in automation science packs */
  cost: number;
  /** crafting steps from a natural resource, for reference; not part of `progress` */
  depth?: number;
}

async function main() {
  const app = process.env.APP;
  const so = resolve(app ?? '.', 'script-output');
  const read = async (p: string): Promise<unknown> =>
    JSON.parse(await fs.readFile(resolve(so, p), 'utf-8'));
  const raw = (await read('data-raw-dump.json')) as RawData;

  const { costs, depths, weights, techCost, max, fallback } = analyse(raw);
  const scale = Math.log10(1 + max);

  const args = process.argv.slice(2);
  const locales: Record<string, RLocale> = Object.fromEntries(
    await Promise.all(
      (await fs.readdir(so))
        .filter((f) => f.endsWith('-locale.json'))
        .map(async (f): Promise<[string, RLocale]> => [
          f.replace(/-locale\.json$/, ''),
          RLocale.parse(await read(f)),
        ]),
    ),
  );

  if (args.includes('--tech')) {
    report(
      [...techCost],
      (id) => resolveLocale(id, locales, 'technology'),
      args.filter((a) => !a.startsWith('--')),
      new Map(),
      scale,
    );
    return;
  }

  const name = (id: string) =>
    resolveLocale(
      id.slice(id.indexOf(':') + 1),
      locales,
      id.startsWith('fluid:') ? 'fluid' : 'item',
    );
  const patterns = args.filter((a) => !a.startsWith('--'));

  console.log('Science pack weights (in automation science packs):');
  for (const [pack, w] of [...weights].sort((a, b) => a[1] - b[1])) {
    console.log(`  ${w.toExponential(3).padStart(10)}  ${pack}`);
  }
  console.log();

  if (patterns.length === 0) {
    if (fallback.length) {
      console.log(`Priced by unlock technology alone (unreachable by recipe): ${fallback.length}`);
      console.log(`  ${fallback.slice(0, 12).join(', ')}\n`);
    }
    histogram([...costs.values()], scale);
    console.log('\nLandmarks:');
    report(
      LANDMARKS.map((id) => [id, costs.get(id)] as const),
      name,
      [],
      depths,
      scale,
    );
    return;
  }
  report([...costs], name, patterns, depths, scale);
}

/** The whole model. Exported so the ingest can pick it up once we are happy with the numbers. */
export function analyse(raw: RawData) {
  const recipes = collectRecipes(raw);
  const unlocks = recipeUnlocks(raw);
  const natural = naturalSources(raw);
  const techs = raw.technology;

  let weights = new Map<string, number>([[UNIT_PACK, 1]]);
  let costs = new Map<ResourceId, number>();
  let techCost = new Map<string, number>();
  let unlockCost = new Map<string, number>();
  let fallback: ResourceId[] = [];

  // Fixed point over the pack weights: five passes in the Bob's/Angel's pack, one per pack tier.
  for (let pass = 0; pass < 20; pass++) {
    techCost = technologyCosts(techs, weights);
    unlockCost = new Map<string, number>();
    for (const [id, r] of recipes) {
      // A synthetic recipe has no technology of its own; what gates it is its ingredients (you
      // need the silo before you can launch a satellite).
      if (r.free || r.synthetic) unlockCost.set(id, 0);
      else {
        const techsFor = unlocks.get(id) ?? [];
        unlockCost.set(
          id,
          techsFor.length
            ? Math.min(...techsFor.map((t) => techCost.get(t) ?? Infinity))
            : Infinity,
        );
      }
    }

    costs = availability(recipes, unlockCost, natural);
    fallback = fillUnreachable(recipes, unlockCost, costs);

    const next = new Map<string, number>([[UNIT_PACK, 1]]);
    let changed = false;
    for (const pack of sciencePacks(techs)) {
      if (pack === UNIT_PACK) continue;
      const cost = costs.get(`item:${pack}`);
      const w = cost === undefined || !isFinite(cost) ? (weights.get(pack) ?? 1) : 1 + cost;
      next.set(pack, w);
      if (Math.abs((weights.get(pack) ?? 1) - w) > 1e-6) changed = true;
    }
    weights = next;
    if (!changed) break;
  }

  // 100% is "you have researched everything": the most expensive technology in the tree. Normalising
  // against the most expensive *resource* instead would be slightly off, because a handful of
  // late technologies unlock nothing you cannot already make more cheaply another way.
  const max = Math.max(...[...techCost.values()].filter(isFinite));
  const scale = Math.log10(1 + max);
  const progress = new Map<ResourceId, number>();
  for (const [id, cost] of costs) progress.set(id, Math.log10(1 + cost) / scale);

  // A recipe costs what running it costs: its own unlock, and having every ingredient to hand.
  // That is the same max the walk takes, but pinned to *this* recipe rather than the cheapest one
  // producing each of its products, so a late alternative recipe reads as late.
  const recipeCost = new Map<string, number>();
  const recipeProgress = new Map<string, number>();
  for (const [id, r] of recipes) {
    let c = unlockCost.get(id) ?? Infinity;
    for (const i of r.ingredients) c = Math.max(c, costs.get(i) ?? Infinity);
    recipeCost.set(id, c);
    if (isFinite(c)) recipeProgress.set(id, Math.log10(1 + c) / scale);
  }

  return {
    costs,
    progress,
    recipeCost,
    recipeProgress,
    depths: chainDepths(recipes, natural),
    weights,
    techCost,
    max,
    fallback,
  };
}

/**
 * The live recipes, plus the three things the game does that are conversions but not recipes: an
 * offshore pump making fluid out of nothing, a rocket launch (the only source of space science
 * before Space Age), and a fuel cell burning down to its depleted form.
 */
function collectRecipes(raw: RawData): Map<string, Rec> {
  const out = new Map<string, Rec>();
  const placedBy = new Map<string, string>();

  for (const [id, r] of Object.entries(raw.recipe)) {
    if (r.hidden || r.parameter) continue; // mods disable content by hiding it, not deleting it
    out.set(id, {
      free: r.enabled !== false,
      ingredients: arr(r.ingredients ?? []).map((i) => rid(RIngredient.parse(i))),
      products: arr(r.results ?? []).map((p) => rid(RProduct.parse(p))),
    });
  }

  // Launching, burning and building are item properties, so only the item subtypes are worth
  // walking — every one of them extends `ItemPrototype` and so carries all three fields. The
  // annotation is what keeps them typed: see `ITEM_KEYS`.
  for (const key of ITEM_KEYS) {
    const items: Record<string, ItemPrototype> = raw[key] ?? {};
    for (const [id, item] of Object.entries(items)) {
      const launched = arr(item.rocket_launch_products ?? []);
      if (launched.length) {
        // You cannot launch without a silo, and the silo eats rocket parts; naming both as
        // ingredients gates the launch on the whole rocket chain without modelling it.
        out.set(`launch:${id}`, {
          free: false,
          synthetic: true,
          ingredients: [`item:${id}`, 'item:rocket-silo', 'item:rocket-part'],
          products: launched.map(rid),
        });
      }
      if (item.burnt_result) {
        out.set(`burn:${id}`, {
          free: false,
          synthetic: true,
          ingredients: [`item:${id}`],
          products: [`item:${item.burnt_result}`],
        });
      }
      if (item.place_result && !placedBy.has(item.place_result)) {
        placedBy.set(item.place_result, id);
      }
    }
  }

  // An offshore pump conjures its fluid from the tile it stands on, which no recipe records. It is
  // where water comes from, and — the reason this matters beyond water — Angel's seafloor pump is
  // the only entry point to the mud line, whose recipes otherwise all consume mud. The fluid is
  // `fluid_box.filter`; the vanilla pump names none and means water. Gate it on the pump item, so
  // the fluid inherits whatever technology unlocks the building.
  for (const [id, pump] of Object.entries(raw['offshore-pump'] ?? {})) {
    const item = placedBy.get(id);
    if (pump.hidden || !item) continue;
    const fluid = pump.fluid_box.filter ?? 'water';
    out.set(`pump:${id}`, {
      free: false,
      synthetic: true,
      ingredients: [`item:${item}`],
      products: [`fluid:${fluid}`],
    });
  }
  return out;
}

/** recipe id -> the live technologies that unlock it */
function recipeUnlocks(raw: RawData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [name, tech] of Object.entries(raw.technology)) {
    if (tech.hidden) continue;
    for (const effect of arr(tech.effects ?? [])) {
      if (effect.type !== 'unlock-recipe') continue;
      const list = out.get(effect.recipe);
      if (list) list.push(name);
      else out.set(effect.recipe, [name]);
    }
  }
  return out;
}

/** Everything the world hands you with no recipe: ores, wood, gardens, fish, biter loot. */
function naturalSources(raw: RawData): Set<ResourceId> {
  const out = new Set<ResourceId>();
  for (const key of NATURAL_KEYS) {
    const entities: Record<string, EntityPrototype> = raw[key] ?? {};
    for (const p of Object.values(entities)) {
      if (!p.autoplace || !p.minable) continue;
      for (const r of arr(p.minable.results ?? [])) out.add(rid(r));
      if (p.minable.result) out.add(`item:${p.minable.result}`);
    }
  }
  for (const key of LOOT_KEYS) {
    const entities: Record<string, EntityWithHealthPrototype> = raw[key] ?? {};
    for (const p of Object.values(entities)) {
      for (const l of arr(p.loot ?? [])) out.add(`item:${l.item}`);
    }
  }
  return out;
}

/** Every item any technology asks for as a research ingredient. */
function sciencePacks(techs: Record<string, TechnologyPrototype>): Set<string> {
  const out = new Set<string>();
  for (const tech of Object.values(techs)) {
    for (const [pack] of arr(tech.unit?.ingredients ?? [])) out.add(pack);
  }
  return out;
}

/** Each technology's cost including its whole prerequisite closure, priced with `weights`. */
function technologyCosts(
  techs: Record<string, TechnologyPrototype>,
  weights: Map<string, number>,
): Map<string, number> {
  const own = new Map<string, number>();
  for (const [name, tech] of Object.entries(techs)) {
    let cost = 0;
    // No `unit` is a 2.0 trigger technology (craft 50 iron plates); a `count_formula` in place of a
    // `count` is infinite research, priced per level. Neither costs science we can attribute.
    const unit = tech.unit;
    if (unit?.count !== undefined) {
      for (const [pack, amount] of arr(unit.ingredients)) {
        cost += amount * unit.count * (weights.get(pack) ?? 1);
      }
    }
    own.set(name, cost);
  }

  // The cost of a technology is the cost of everything you had to research to reach it, so sum
  // over the prerequisite *closure*. `stack` only guards against a mod shipping a cycle.
  const closure = new Map<string, Set<string>>();
  const closureOf = (name: string, stack = new Set<string>()): Set<string> => {
    const cached = closure.get(name);
    if (cached) return cached;
    if (stack.has(name)) return new Set([name]);
    stack.add(name);
    const set = new Set<string>([name]);
    for (const prereq of arr(techs[name]?.prerequisites ?? [])) {
      if (!techs[prereq]) continue;
      for (const t of closureOf(prereq, stack)) set.add(t);
    }
    stack.delete(name);
    closure.set(name, set);
    return set;
  };

  const total = new Map<string, number>();
  for (const name of Object.keys(techs)) {
    let sum = 0;
    for (const t of closureOf(name)) sum += own.get(t) ?? 0;
    total.set(name, sum);
  }
  return total;
}

/**
 * Minimax hypergraph Dijkstra. Having a resource costs what the cheapest recipe producing it
 * costs; a recipe costs the max of its unlock cost and every ingredient's cost. A closed cycle
 * simply never settles, which is right — you cannot bootstrap one.
 */
function availability(
  recipes: Map<string, Rec>,
  unlockCost: Map<string, number>,
  natural: Set<ResourceId>,
): Map<ResourceId, number> {
  const consumers = new Map<ResourceId, string[]>();
  for (const [id, r] of recipes) {
    for (const i of new Set(r.ingredients)) {
      const list = consumers.get(i);
      if (list) list.push(id);
      else consumers.set(i, [id]);
    }
  }

  const cost = new Map<ResourceId, number>();
  const settled = new Set<ResourceId>();
  const queue: [number, ResourceId][] = [];
  const offer = (id: ResourceId, v: number) => {
    if (v >= (cost.get(id) ?? Infinity)) return;
    cost.set(id, v);
    queue.push([v, id]);
  };

  for (const id of natural) offer(id, 0);
  // Ingredient-free recipes — Angel's void sinks, a couple of mining recipes — are ready the
  // moment they are researched.
  for (const [id, r] of recipes) {
    if (r.ingredients.length) continue;
    for (const p of r.products) offer(p, unlockCost.get(id)!);
  }

  while (queue.length) {
    queue.sort((a, b) => b[0] - a[0]);
    const [v, id] = queue.pop()!;
    if (settled.has(id) || v > cost.get(id)!) continue;
    settled.add(id);
    for (const recipeId of consumers.get(id) ?? []) {
      const r = recipes.get(recipeId)!;
      let c = unlockCost.get(recipeId)!;
      let ready = true;
      for (const i of r.ingredients) {
        if (!settled.has(i)) {
          ready = false;
          break;
        }
        c = Math.max(c, cost.get(i)!);
      }
      if (!ready || !isFinite(c)) continue;
      for (const p of r.products) offer(p, c);
    }
  }
  return cost;
}

/**
 * What the walk could not reach: closed cycles, where every recipe for a thing consumes something
 * downstream of that thing. Price those by their unlock technology and whatever ingredients *are*
 * reachable, ignoring the ones that are not — wrong, but far less wrong than "unobtainable".
 *
 * This should stay a short list. A long one means a real source is missing: Angel's whole mud line
 * looked like a closed cycle until the seafloor pump (an `offshore-pump` filtered to viscous mud)
 * was modelled, and it dragged clay bricks and the tier-2 ore buildings in with it.
 */
function fillUnreachable(
  recipes: Map<string, Rec>,
  unlockCost: Map<string, number>,
  cost: Map<ResourceId, number>,
): ResourceId[] {
  const before = new Set(cost.keys());
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (const [id, r] of recipes) {
      let c = unlockCost.get(id)!;
      if (!isFinite(c)) continue;
      for (const i of r.ingredients) c = Math.max(c, cost.get(i) ?? 0);
      for (const p of r.products) {
        if ((cost.get(p) ?? Infinity) > c) {
          cost.set(p, c);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return [...cost.keys()].filter((id) => !before.has(id));
}

/** Crafting steps from a natural resource. Reported alongside, not folded into `progress`. */
function chainDepths(recipes: Map<string, Rec>, natural: Set<ResourceId>): Map<ResourceId, number> {
  const depth = new Map<ResourceId, number>();
  for (const id of natural) depth.set(id, 0);
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    for (const r of recipes.values()) {
      let d = 0;
      let ready = true;
      for (const i of r.ingredients) {
        const x = depth.get(i);
        if (x === undefined) {
          ready = false;
          break;
        }
        d = Math.max(d, x);
      }
      if (!ready) continue;
      for (const p of r.products) {
        if ((depth.get(p) ?? Infinity) > d + 1) {
          depth.set(p, d + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return depth;
}

function histogram(costs: number[], scale: number) {
  const finite = costs.filter(isFinite);
  const buckets: number[] = new Array<number>(10).fill(0);
  for (const c of finite) {
    buckets[Math.min(9, Math.floor((Math.log10(1 + c) / scale) * 10))]++;
  }
  console.log(`${finite.length} resources, deepest costs ${Math.max(...finite).toExponential(3)}:`);
  const wide = Math.max(...buckets);
  buckets.forEach((n, i) => {
    console.log(
      `  ${String(i * 10).padStart(3)}-${String(i * 10 + 10).padEnd(3)}% ${'#'.repeat(Math.round((n / wide) * 50)).padEnd(50)} ${n}`,
    );
  });
}

function report(
  entries: readonly (readonly [string, number | undefined])[],
  name: (id: string) => string | undefined,
  patterns: string[],
  depths: Map<string, number>,
  scale: number,
) {
  const rows = entries
    .filter(([id]) => patterns.length === 0 || patterns.some((p) => id.includes(p)))
    .sort((a, b) => (a[1] ?? Infinity) - (b[1] ?? Infinity));
  for (const [id, cost] of rows) {
    const pct =
      cost === undefined || !isFinite(cost)
        ? '  n/a'
        : ((Math.log10(1 + cost) / scale) * 100).toFixed(1).padStart(5);
    const depth = depths.get(id);
    console.log(`${pct}%  ${String(depth ?? '-').padStart(3)}  ${id.padEnd(46)} ${name(id) ?? ''}`);
  }
}

/** A hand-picked spread to eyeball the numbers against: does this feel like game order? */
const LANDMARKS: ResourceId[] = [
  'item:iron-gear-wheel',
  'item:inserter',
  'item:angels-ore1',
  'item:angels-ore-crusher',
  'item:transport-belt',
  'item:steel-plate',
  'item:electronic-circuit',
  'item:logistic-science-pack',
  'item:angels-solid-lime',
  'item:assembling-machine-2',
  'item:accumulator',
  'item:solar-panel',
  'item:bob-plastic-pipe',
  'item:advanced-circuit',
  'item:chemical-science-pack',
  'item:construction-robot',
  'item:beacon',
  'item:assembling-machine-3',
  'item:electric-furnace',
  'item:production-science-pack',
  'item:nuclear-reactor',
  'item:processing-unit',
  'item:bob-alien-science-pack',
  'item:utility-science-pack',
  'item:speed-module-3',
  'item:bob-beacon-3',
  'item:rocket-silo',
  'item:space-science-pack',
  'item:aai-ultimate-loader',
  'item:bob-power-armor-mk5',
];

// importable: `analyse` is the reusable half, `main` only runs when this is the entry point
if (import.meta.filename === process.argv[1]) await main();
