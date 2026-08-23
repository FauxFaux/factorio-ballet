import type { Machine, MachineId, Recipe, ResourceId, StaticData } from './types.ts';
import staticDataJson from './assets/static.json';

export const staticData = staticDataJson as StaticData;

/** The display name for a resource, falling back to its id. */
export function resourceName(id: ResourceId): string {
  return staticData.resources[id]?.human ?? id;
}

/** The display name for a recipe, falling back to its id. */
export function recipeName(id: string): string {
  return staticData.recipes[id]?.human ?? id;
}

/**
 * Sort key for "simplest first": how far into the tech tree a recipe or resource is. Something with
 * no complexity at all is unreachable — nothing in the tree unlocks it — so it sorts last, not
 * first.
 */
export function complexityOf(of: { complexity?: number }): number {
  return of.complexity ?? Infinity;
}

/**
 * Sort key for "closest to where I am in the game": how far a recipe or resource sits from
 * `progress`, in either direction. Things you passed long ago and things still several tiers away
 * are both irrelevant to what you are building now, so plain distance is the whole idea; a
 * `progress` of 0 makes this exactly `complexityOf`.
 *
 * Distance is linear because `complexity` is already logarithmic (see `scripts/complexity.ts`), so
 * a gap of 0.1 means about the same amount of game wherever on the scale you are.
 */
export function relevanceOf(of: { complexity?: number }, progress: number): number {
  return of.complexity === undefined ? Infinity : Math.abs(of.complexity - progress);
}

/** ~16px of icon on a ~400px track; any closer and two landmarks overlap instead of reading. */
const MIN_PACK_GAP = 0.04;

/** A science pack and where on the complexity scale it sits: one mark on the progress slider. */
export interface Landmark {
  id: ResourceId;
  complexity: number;
}

/**
 * The science packs the progress slider is labelled with: the game's own list, thinned so the icons
 * do not sit on top of each other. Ten of Bob's packs land between 0.53 and 0.58 — a real wall in
 * that pack, but ten icons in the width of one — so a pack within `MIN_PACK_GAP` of the last one
 * kept is dropped. Keeping the cheapest of each cluster is what leaves the survivors the packs
 * people actually name their progress after.
 */
export const packLandmarks: Landmark[] = (() => {
  const out: Landmark[] = [];
  for (const id of staticData.sciencePacks) {
    const complexity = staticData.resources[id]?.complexity;
    if (complexity === undefined) continue;
    const last = out[out.length - 1];
    if (last && complexity - last.complexity < MIN_PACK_GAP) continue;
    out.push({ id, complexity });
  }
  return out;
})();

/** The display name for a machine, falling back to its id. */
export function machineName(id: MachineId): string {
  return staticData.machines[id]?.human ?? id;
}

export interface MachineMatch {
  id: MachineId;
  machine: Machine;
  /** See {@link machineComplexity}; on the match rather than `Machine`, as the game data has none. */
  complexity?: number;
}

/**
 * How far into the game a machine is: when you can have the item which places it, which is what
 * that item's complexity already says. Nothing in `data.raw` gives a machine a complexity of its
 * own, and it would be the same walk. The character has no placing item because you start with it,
 * so hand crafting is 0 — the crash site.
 */
function machineComplexity(machine: Machine): number | undefined {
  if (machine.item === undefined) return machine.kind === 'character' ? 0 : undefined;
  return staticData.resources[`item:${machine.item}`]?.complexity;
}

/** Machines by the categories they can craft, built once. */
const byCategory = ((): Map<string, MachineMatch[]> => {
  const index = new Map<string, MachineMatch[]>();
  for (const [id, machine] of Object.entries(staticData.machines)) {
    for (const category of machine.categories) {
      let list = index.get(category);
      if (!list) index.set(category, (list = []));
      list.push({ id, machine, complexity: machineComplexity(machine) });
    }
  }
  return index;
})();

/**
 * The machines which can run a recipe: anything handling any of its categories, slowest first, so
 * the tiers of a machine family read in order.
 */
export function machinesFor(recipe: Recipe): MachineMatch[] {
  const found = new Map<MachineId, MachineMatch>();
  for (const category of recipe.categories) {
    for (const match of byCategory.get(category) ?? []) found.set(match.id, match);
  }
  return [...found.values()].sort(
    (a, b) => a.machine.speed - b.machine.speed || a.id.localeCompare(b.id),
  );
}

/**
 * Which machine to assume when nobody has chosen one: the one nearest `progress`, by the rule the
 * searches already sort by — an assembling machine 1 is as wrong at space science as a tier 6 is on
 * red. The slowest-first list this picks from is a tier order and stays one, so the answer is
 * usually somewhere in the middle of it rather than at the top.
 *
 * Ties go to the faster machine, then to the id, so the answer is stable. Two machines nothing
 * unlocks are equally irrelevant rather than incomparable: `Infinity - Infinity` is a falsy NaN,
 * which falls through to those tie-breaks, as it does in `searchRecipes`.
 */
export function defaultMachine(
  machines: MachineMatch[],
  progress: number,
): MachineMatch | undefined {
  let best: MachineMatch | undefined;
  for (const match of machines) {
    if (!best || compareMachines(match, best, progress) < 0) best = match;
  }
  return best;
}

/** Nearest `progress` first, then faster, then by id. */
function compareMachines(a: MachineMatch, b: MachineMatch, progress: number): number {
  return (
    relevanceOf(a, progress) - relevanceOf(b, progress) ||
    b.machine.speed - a.machine.speed ||
    a.id.localeCompare(b.id)
  );
}
