import type { Machine, MachineId, Recipe } from '../types.ts';
import { staticData } from './decode.ts';

function complexityOf(of: { complexity?: number }): number {
  return of.complexity ?? Infinity;
}

function relevanceOf(of: { complexity?: number }, progress: number): number {
  return of.complexity === undefined ? Infinity : Math.abs(of.complexity - progress);
}

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
 * Drops any machine a cheaper one already beats on speed: a "newer" machine — more complexity to
 * reach — which is not even faster than something you could have built earlier is never the right
 * default, so `defaultMachine` should act as though it were not in the list at all. Sorting by
 * complexity and tracking the fastest speed seen so far catches this in one pass; a same-tier
 * machine is never judged against its own tier, because {@link machinesFor}'s slowest-first order
 * survives the (stable) sort as the tie-break, so a tier's slower member is always seen before the
 * faster one and so never eliminates it.
 *
 * Hand crafting does not set the bar: the character's un-modded crafting speed is 1, quicker than
 * the first couple of assembling-machine tiers, but building one is what lets the tree move on
 * without you standing at it, which is not something "speed" alone prices in.
 */
function dropDominatedMachines(machines: MachineMatch[]): MachineMatch[] {
  const byComplexity = [...machines].sort((a, b) => complexityOf(a) - complexityOf(b));
  const kept: MachineMatch[] = [];
  let fastestSoFar = -Infinity;
  for (const match of byComplexity) {
    if (match.machine.speed < fastestSoFar) continue;
    kept.push(match);
    if (match.machine.kind !== 'character') {
      fastestSoFar = Math.max(fastestSoFar, match.machine.speed);
    }
  }
  return kept;
}

/**
 * Which machine to assume when nobody has chosen one: the one nearest `progress`, by the rule the
 * searches already sort by — an assembling machine 1 is as wrong at space science as a tier 6 is on
 * red. The slowest-first list this picks from is a tier order and stays one, so the answer is
 * usually somewhere in the middle of it rather than at the top — except for a newer-but-slower
 * machine {@link dropDominatedMachines} has already taken out of contention.
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
  for (const match of dropDominatedMachines(machines)) {
    if (!best || compareMachines(match, best, progress) < 0) best = match;
  }
  return best;
}

function compareMachines(a: MachineMatch, b: MachineMatch, progress: number): number {
  return (
    relevanceOf(a, progress) - relevanceOf(b, progress) ||
    b.machine.speed - a.machine.speed ||
    a.id.localeCompare(b.id)
  );
}
