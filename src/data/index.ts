import type {
  Beacon,
  BeaconId,
  Belt,
  BeltId,
  Machine,
  MachineId,
  ModuleId,
  Recipe,
  ResourceId,
} from '../types.ts';
import { staticData } from './decode.ts';

export { staticData };

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

/** The display name for a module: the item's, because a module is the item you craft. */
export function moduleName(id: ModuleId): string {
  return resourceName(`item:${id}`);
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
 * Drops any machine a cheaper one already beats on speed: a "newer" machine — more complexity to
 * reach — which is not even faster than something you could have built earlier is never the right
 * default, so `defaultMachine` should act as though it were not in the list at all. Sorting by
 * complexity and tracking the fastest speed seen so far catches this in one pass; a same-tier
 * machine is never judged against its own tier, because {@link machinesFor}'s slowest-first order
 * survives the (stable) sort as the tie-break, so a tier's slower member is always seen before its
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

/** Nearest `progress` first, then faster, then by id. */
function compareMachines(a: MachineMatch, b: MachineMatch, progress: number): number {
  return (
    relevanceOf(a, progress) - relevanceOf(b, progress) ||
    b.machine.speed - a.machine.speed ||
    a.id.localeCompare(b.id)
  );
}

export {
  allowsEffect,
  BOOST_CATEGORY,
  categoryEffect,
  categoryName,
  chosenModule,
  chosenModules,
  defaultModule,
  familyFor,
  headlineEffect,
  moduleFor,
  modulesFor,
  modulesIn,
  moduleCategories,
  PRODUCTIVITY_CATEGORY,
  SPEED_CATEGORY,
  takesCategory,
} from './modules.ts';
export type {
  BoostEffect,
  ChosenModules,
  ModuleCategory,
  ModuleChoice,
  ModuleMatch,
} from './modules.ts';

import { chosenModules } from './modules.ts';
import type { ChosenModules, ModuleChoice } from './modules.ts';

/**
 * The beacons this pack has, cheapest first: one tier of the same idea, as the module families are.
 *
 * A beacon is placed by an item of the same name, so — exactly as for a {@link Module} — the icon
 * and the complexity are on the `item:<id>` resource and only the slots and the transmission are
 * the beacon's own.
 */
export interface BeaconMatch {
  id: BeaconId;
  beacon: Beacon;
  /** The complexity of the item which places it, which is the beacon's; as {@link ModuleMatch}. */
  complexity?: number;
}

/** Cheapest first, then the smaller beacon, then by id — as {@link cheapestModule}. */
export const beaconTiers: BeaconMatch[] = Object.entries(staticData.beacons ?? {})
  .map(([id, beacon]) => ({
    id,
    beacon,
    complexity: staticData.resources[`item:${beacon.item ?? id}`]?.complexity,
  }))
  .sort(
    (a, b) =>
      complexityOf(a) - complexityOf(b) ||
      a.beacon.moduleSlots - b.beacon.moduleSlots ||
      a.id.localeCompare(b.id),
  );

/** What a beacon is called; its own name, unlike a module's, which is its item's. */
export function beaconName(id: BeaconId): string {
  return staticData.beacons[id]?.human ?? id;
}

/**
 * How many modules' worth one full beacon of this kind transmits, before the count penalty: the
 * number the choice between two tiers actually turns on, since every beacon here transmits the same
 * 150% and only the slot count differs. Six slots at 1.5 is nine modules from one beacon.
 */
export function beaconWorth(beacon: Beacon): number {
  return beacon.moduleSlots * beacon.distributionEffectivity;
}

/**
 * Which beacon to assume when nobody has chosen one: {@link defaultModule}'s rule, and for
 * {@link defaultModule}'s reason — the best you could already have built, and none at all until
 * that is nothing. A beacon is a thing you build, so "none" is the honest answer for as long as
 * the technology is out of reach, and a row's speed modules then have nowhere to go but the
 * machine's own slots.
 *
 * That the answer moves with the slider is the point and not a wart, though it moves *upwards*: a
 * bigger beacon is fewer beacons for the same modules and so a better transmission, so a cell gets
 * quietly better as the game goes on rather than jumping about. Pin one in the header to stop it.
 */
export function defaultBeacon(progress: number): BeaconMatch | undefined {
  return beaconTiers.findLast((match) => complexityOf(match) <= progress);
}

/**
 * Which beacon the user wants built where a row's speed modules overflow the machine. Three states,
 * as {@link ModuleChoice}'s are: an id, `null` for none — no beacons, however far through the game
 * you are — and absent for nobody having decided, which follows the progress slider through
 * {@link defaultBeacon}.
 */
export type BeaconChoice = BeaconId | null | undefined;

/** Which beacon a row builds right now: the one pinned, or {@link defaultBeacon}'s. */
export function chosenBeacon(choice: BeaconChoice, progress: number): Beacon | undefined {
  if (choice !== undefined) return choice === null ? undefined : staticData.beacons[choice];
  return defaultBeacon(progress)?.beacon;
}

/** A belt tier, joined with the complexity of the item which places it. */
export interface BeltMatch {
  id: BeltId;
  belt: Belt;
  /** The complexity of the item which places it, which is the belt's. */
  complexity?: number;
}

/** Every belt tier, cheapest first, then by throughput and id to give equal tiers a stable order. */
export const beltTiers: BeltMatch[] = Object.entries(staticData.belts)
  .map(([id, belt]) => ({
    id,
    belt,
    complexity: staticData.resources[`item:${belt.item ?? id}`]?.complexity,
  }))
  .sort(
    (a, b) =>
      complexityOf(a) - complexityOf(b) ||
      a.belt.itemsPerSecond - b.belt.itemsPerSecond ||
      a.id.localeCompare(b.id),
  );

/** The belt's own name, unlike a module's, which is the name of its item. */
export function beltName(id: BeltId): string {
  return staticData.belts[id]?.human ?? id;
}

/** The fastest belt already available at this point in the tech tree. */
export function defaultBelt(progress: number): BeltMatch {
  return beltTiers.findLast((match) => complexityOf(match) <= progress) ?? beltTiers[0];
}

/** An id pins a belt, and absent follows {@link defaultBelt}. */
export type BeltChoice = BeltId | undefined;

/** The belt the header means right now: a pinned choice, or {@link defaultBelt}'s. */
export function chosenBelt(choice: BeltChoice, progress: number): Belt {
  if (choice !== undefined) return staticData.belts[choice];
  return defaultBelt(progress).belt;
}

/**
 * What the header says a row has to spend: which module each family means, which beacon gets built
 * where a row's speed modules overflow the machine, and which belt will eventually constrain it.
 *
 * One object because it is one decision — what you have built by now — and every row spends all of
 * it. A row states how many modules it wants for an effect and never which module, which family or
 * which beacon, so this is where those decisions are answered once for the app rather than once per
 * row. {@link NO_CHOICE} is the empty answer: no modules, no beacons, which is the crash site.
 */
export interface Chosen {
  modules: ChosenModules;
  /** Absent is none, and the early game's honest answer: you have not built a beacon yet. */
  beacon?: Beacon;
  belt: Belt;
}

/** Nothing chosen at all: an unmodded machine with no beacons round it. */
export const NO_CHOICE: Chosen = { modules: {}, belt: defaultBelt(0).belt };

/** Every part of {@link Chosen} resolved against the header's choices and the progress slider. */
export function resolveChosen(
  choice: ModuleChoice,
  beacon: BeaconChoice,
  belt: BeltChoice,
  progress: number,
): Chosen {
  return {
    modules: chosenModules(choice, progress),
    beacon: chosenBeacon(beacon, progress),
    belt: chosenBelt(belt, progress),
  };
}
