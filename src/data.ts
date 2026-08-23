import type { Machine, MachineId, Recipe, ResourceId, StaticData } from './types.ts';
import staticDataJson from './assets/static.json';

export const staticData = staticDataJson as StaticData;

/** The display name for a resource, falling back to its id. */
export function resourceName(id: ResourceId): string {
  return staticData.resources[id]?.human ?? id;
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
}

/** Machines by the categories they can craft, built once. */
const byCategory = ((): Map<string, MachineMatch[]> => {
  const index = new Map<string, MachineMatch[]>();
  for (const [id, machine] of Object.entries(staticData.machines)) {
    for (const category of machine.categories) {
      let list = index.get(category);
      if (!list) index.set(category, (list = []));
      list.push({ id, machine });
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
