import type { Machine, MachineId, Recipe, ResourceId, StaticData } from './types.ts';
import staticDataJson from './assets/static.json';

export const staticData = staticDataJson as StaticData;

/** The display name for a resource, falling back to its id. */
export function resourceName(id: ResourceId): string {
  return staticData.resources[id]?.human ?? id;
}

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
