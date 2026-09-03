import type { Beacon, BeaconId, Belt, BeltId, ModuleId, ResourceId } from '../types.ts';
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
