import type { Blueprint } from '../../src/bp/decode.ts';

export type Amounts = Record<string, number>;

export interface MilestoneTechnology {
  human: string;
  prerequisites: string[];
  science: Amounts;
  /** Raw research unit count and seconds per unit, before lab speed or productivity bonuses. */
  researchUnit?: { count?: number; time: number };
  complexity: number;
  unlocks: string[];
  trigger?: unknown;
  formula?: string;
}

/** One explicitly chosen, single-output production route. Amounts use item:/fluid: ids. */
export interface MilestoneRecipe {
  product: string;
  yield: number;
  expectedYield: boolean;
  ingredients: Amounts;
  technology?: string;
  machine?: string;
}

export interface MilestoneData {
  provenance: { dataset: string; rawSha256: string; staticSha256: string; recipesSha256: string };
  boundaries: Record<'plates' | 'raw', string[]>;
  technologies: Record<string, MilestoneTechnology>;
  recipes: Record<string, MilestoneRecipe>;
  routes: Record<string, string>;
  buildings: Record<
    string,
    { human: string; entity: string; type: string; complexity: number; placeCount: number }
  >;
}

export interface Milestone {
  buildings: Amounts;
  /** Recipes configured on placed machines; these are unlock goals, not production quantities. */
  recipes: string[];
  /** Additional research goals. This is never inferred from the complexity ordering. */
  technologies: string[];
}

export function sorted(amounts: Amounts): Amounts {
  return Object.fromEntries(
    Object.entries(amounts)
      .filter(([, n]) => Math.abs(n) > 1e-9)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function add(target: Amounts, source: Amounts, factor = 1): void {
  for (const [id, n] of Object.entries(source)) target[id] = (target[id] ?? 0) + n * factor;
}

export function closure(data: MilestoneData, targets: Iterable<string>): string[] {
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    const tech = data.technologies[id];
    if (!tech) throw new Error(`Unknown technology: ${id}`);
    if (visiting.has(id)) throw new Error(`Technology cycle: ${id}`);
    visiting.add(id);
    for (const p of tech.prerequisites) visit(p);
    visiting.delete(id);
    done.add(id);
  };
  for (const target of targets) visit(target);
  return [...done];
}

export function scienceCost(data: MilestoneData, technologies: Iterable<string>): Amounts {
  const out: Amounts = {};
  for (const id of new Set(technologies)) {
    const tech = data.technologies[id];
    if (!tech) throw new Error(`Unknown technology: ${id}`);
    if (tech.formula) throw new Error(`Research level required for ${id}: ${tech.formula}`);
    add(out, tech.science);
  }
  return sorted(out);
}

/**
 * Aggregate all demand before rounding each recipe's crafts. This preserves shared intermediates
 * and multi-item yields (belts, undergrounds, circuits, cards). Cycles and missing routes fail closed.
 */
export function bill(
  data: MilestoneData,
  demand: Amounts,
  boundary: readonly string[],
  wholeCrafts = false,
  inventory: Amounts = {},
) {
  const stops = new Set(boundary);
  const done = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`Production cycle: ${id}`);
    visiting.add(id);
    if (!stops.has(id)) {
      const recipe = data.recipes[data.routes[id]];
      if (!recipe || recipe.product !== id || recipe.yield <= 0) {
        throw new Error(`No production route or external boundary for ${id}`);
      }
      for (const ingredient of Object.keys(recipe.ingredients)) visit(ingredient);
    }
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  for (const [id, n] of Object.entries(demand)) {
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid demand for ${id}: ${n}`);
    if (n > 0) visit(id);
  }
  const needed = { ...demand };
  const materials: Amounts = {};
  const crafts: Amounts = {};
  const surplus: Amounts = {};
  const reused: Amounts = {};
  const expectedYields: string[] = [];
  for (const id of order.reverse()) {
    const demand = needed[id] ?? 0;
    const used = Math.min(demand, inventory[id] ?? 0);
    const n = demand - used;
    if (used > 0) reused[id] = used;
    if (n === 0) continue;
    if (stops.has(id)) {
      materials[id] = n;
      continue;
    }
    const recipeId = data.routes[id];
    const recipe = data.recipes[recipeId];
    const runs = wholeCrafts ? Math.ceil(n / recipe.yield - 1e-9) : n / recipe.yield;
    crafts[recipeId] = runs;
    surplus[id] = runs * recipe.yield - n;
    if (recipe.expectedYield) expectedYields.push(recipeId);
    add(needed, recipe.ingredients, runs);
  }
  return {
    materials: sorted(materials),
    crafts: sorted(crafts),
    surplus: sorted(surplus),
    reused: sorted(reused),
    expectedYields,
  };
}

/** Research for the supplied capital, its ingredients, configured recipes, and crafting machines. */
export function researchFor(data: MilestoneData, milestone: Milestone) {
  const technologies = new Set(milestone.technologies);
  const recipes = new Set<string>();
  const machines = new Set<string>();
  const visitItem = (id: string) => {
    if (data.boundaries.raw.includes(id)) return;
    const route = data.routes[id];
    if (!route) throw new Error(`No production route for research requirement ${id}`);
    visitRecipe(route);
  };
  const visitRecipe = (id: string) => {
    if (recipes.has(id)) return;
    const recipe = data.recipes[id];
    if (!recipe) throw new Error(`Unknown planning recipe: ${id}`);
    recipes.add(id);
    if (recipe.technology) technologies.add(recipe.technology);
    for (const ingredient of Object.keys(recipe.ingredients)) visitItem(ingredient);
    if (recipe.machine) {
      machines.add(recipe.machine);
      visitItem(`item:${recipe.machine}`);
    }
  };
  for (const [id, n] of Object.entries(milestone.buildings)) if (n > 0) visitItem(`item:${id}`);
  for (const id of milestone.recipes) visitRecipe(id);
  // Making the research cards can itself require research (e.g. sulfuric acid for blue cards).
  let all = closure(data, technologies);
  for (;;) {
    const before = recipes.size;
    for (const pack of Object.keys(scienceCost(data, all))) visitItem(`item:${pack}`);
    all = closure(data, technologies);
    if (before === recipes.size) break;
  }
  return { technologies: all, machines: [...machines].sort() };
}

export function blueprintMilestone(data: MilestoneData, blueprint: Blueprint): Milestone {
  if (blueprint.tiles?.length)
    throw new Error('Tile costs are not supported by this planning snapshot');
  const entities = new Map(
    Object.entries(data.buildings).map(([id, b]) => [b.entity, [id, b.placeCount] as const]),
  );
  const buildings: Amounts = {};
  const recipes = new Set<string>();
  for (const entity of blueprint.entities ?? []) {
    if (entity.items && Object.keys(entity.items).length)
      throw new Error(`Item requests on ${entity.name} require an explicit inventory goal`);
    if ('quality' in entity && entity.quality !== 'normal')
      throw new Error(`Unsupported quality on ${entity.name}`);
    const placing = entities.get(entity.name);
    if (!placing) throw new Error(`Unknown planning building: ${entity.name}`);
    const [item, count] = placing;
    buildings[item] = (buildings[item] ?? 0) + count;
    if (entity.recipe) recipes.add(entity.recipe);
  }
  return { buildings: sorted(buildings), recipes: [...recipes].sort(), technologies: [] };
}

/** Reuse retained capital and upgrade ingredients; removed capital never earns raw-material credit. */
export function compare(
  data: MilestoneData,
  from: Milestone,
  to: Milestone,
  boundary: readonly string[] = data.boundaries.plates,
  wholeCrafts = false,
) {
  const added: Amounts = {};
  const removed: Amounts = {};
  for (const id of new Set([...Object.keys(from.buildings), ...Object.keys(to.buildings)])) {
    const delta = (to.buildings[id] ?? 0) - (from.buildings[id] ?? 0);
    if (delta > 0) added[`item:${id}`] = delta;
    if (delta < 0) removed[`item:${id}`] = -delta;
  }
  const before = new Set(researchFor(data, from).technologies);
  const target = researchFor(data, to);
  const technologies = target.technologies.filter((id) => !before.has(id));
  const science = scienceCost(data, technologies);
  const scienceDemand = Object.fromEntries(
    Object.entries(science).map(([id, n]) => [`item:${id}`, n]),
  );
  const construction = bill(data, added, boundary, wholeCrafts, removed);
  const research = bill(data, scienceDemand, boundary, wholeCrafts);
  const combined: Amounts = { ...added };
  add(combined, scienceDemand);
  return {
    added: sorted(added),
    removed: sorted(removed),
    technologies,
    triggers: technologies.filter((id) => data.technologies[id].trigger !== undefined),
    science,
    construction,
    research,
    total: bill(data, combined, boundary, wholeCrafts, removed),
    requiredCraftingMachines: target.machines,
    uncountedCraftingMachines: target.machines.filter((id) => !(to.buildings[id] > 0)),
  };
}

export const EMPTY_MILESTONE: Milestone = { buildings: {}, recipes: [], technologies: [] };
