import type {
  Beacon,
  Effect,
  Machine,
  MachineId,
  Module,
  ModuleId,
  Recipe,
  ResourceId,
  StaticData,
} from './types.ts';
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

/**
 * Whether a machine applies one of the module effects. Absent means no restriction — see
 * `Machine.allowedEffects`, and note that the game ignores a disallowed effect rather than refusing
 * the module carrying it.
 */
export function allowsEffect(machine: Machine, effect: Effect): boolean {
  return machine.allowedEffects?.includes(effect) ?? true;
}

export interface ModuleMatch {
  id: ModuleId;
  module: Module;
  /** The complexity of the module's item, which is the module's; as `MachineMatch.complexity`. */
  complexity?: number;
}

/**
 * The modules which would do something in this machine on this recipe, cheapest first.
 *
 * Three gates, and each one of them is a way to overstate throughput by a lot if it is skipped:
 * the machine must have slots at all, it must take the module's category, and at least one of the
 * two effects we model has to survive both `Machine.allowedEffects` and — for productivity —
 * `Recipe.allowProductivity`, which only 335 of the 2330 recipes here set. A productivity module
 * on a recipe which does not allow it is not a worse choice but a purely negative one — its speed
 * malus and nothing else — so it is not offered at all.
 *
 * Cheapest first rather than by tier: the tiers of one family come out in order anyway, because a
 * module is unlocked by the research which makes it, and the families interleave the way the
 * search results do.
 */
export function modulesFor(machine: Machine, recipe: Recipe): ModuleMatch[] {
  if (!machine.moduleSlots) return [];
  const out: ModuleMatch[] = [];
  for (const [id, module] of Object.entries(staticData.modules)) {
    if (!(machine.allowedModuleCategories?.includes(module.category) ?? true)) continue;
    // a *bonus* which survives, not merely an effect: a productivity module's speed is negative,
    // so on a recipe which does not allow productivity it is the only thing left of it
    const faster = (module.speed ?? 0) > 0 && allowsEffect(machine, 'speed');
    const moreOut =
      (module.productivity ?? 0) > 0 &&
      allowsEffect(machine, 'productivity') &&
      recipe.allowProductivity;
    if (!faster && !moreOut) continue;
    out.push({ id, module, complexity: staticData.resources[`item:${id}`]?.complexity });
  }
  return out.sort(cheapestModule);
}

/**
 * A module category as the app offers it: the game's `module-category` id, and a name for it. The
 * ids are the game's; the names are ours, because a `module-category` prototype carries no
 * `localised_name` to ingest and `angels-bio-yield` is not what anyone calls the modules that go in
 * a farm.
 */
export interface ModuleCategory {
  id: string;
  human: string;
  /** The effect the category is *for*, and so the one a picker quotes; see {@link headlineEffect}. */
  effect: 'speed' | 'productivity';
}

/**
 * The three families this pack has, in the order a picker should show them. Productivity modules
 * also change speed and bio-yield modules do not, but what you pick either of them *for* is the
 * yield, which is why the effect is stated here rather than guessed from the module.
 */
const KNOWN_CATEGORIES: ModuleCategory[] = [
  { id: 'speed', human: 'speed', effect: 'speed' },
  { id: 'productivity', human: 'productivity', effect: 'productivity' },
  { id: 'angels-bio-yield', human: 'agricultural', effect: 'productivity' },
];

/** Cheapest first, then up the tiers, then by id: the order every list of modules comes out in. */
const cheapestModule = (a: ModuleMatch, b: ModuleMatch): number =>
  complexityOf(a) - complexityOf(b) || a.module.tier - b.module.tier || a.id.localeCompare(b.id);

/** Every module there is, grouped by category and cheapest first, built once. */
const byModuleCategory = ((): Map<string, ModuleMatch[]> => {
  const index = new Map<string, ModuleMatch[]>();
  for (const [id, module] of Object.entries(staticData.modules)) {
    let list = index.get(module.category);
    if (!list) index.set(module.category, (list = []));
    list.push({ id, module, complexity: staticData.resources[`item:${id}`]?.complexity });
  }
  for (const list of index.values()) list.sort(cheapestModule);
  return index;
})();

/**
 * The categories there are actually modules for: the known three first and in their order, then
 * anything else the dataset has, under its bare id. A regenerated dump with a fourth family in it
 * should grow a picker rather than quietly lose the modules — and it names its own effect, so an
 * unknown category is quoted by whichever of the two its modules add to.
 */
export const moduleCategories: ModuleCategory[] = [
  ...KNOWN_CATEGORIES.filter(({ id }) => byModuleCategory.has(id)),
  ...[...byModuleCategory]
    .filter(([id]) => !KNOWN_CATEGORIES.some((known) => known.id === id))
    .map(([id, modules]) => ({
      id,
      human: id,
      effect: modules.some(({ module }) => (module.productivity ?? 0) > 0)
        ? ('productivity' as const)
        : ('speed' as const),
    })),
];

/** The modules in one category, cheapest first — all of them, whatever machine or recipe. */
export function modulesIn(category: string): ModuleMatch[] {
  return byModuleCategory.get(category) ?? [];
}

/** What a module does, by the effect its category is picked for: the number a picker shows. */
export function headlineEffect(category: ModuleCategory, module: Module): number {
  return module[category.effect] ?? 0;
}

/**
 * Which module in a category to assume when nobody has chosen one: the best you could already have
 * built, and `undefined` — none, empty slots — while that is nothing. That is not
 * {@link defaultMachine}'s nearest-`progress` rule, and the difference is none: a machine has to be
 * *some* machine, so nearest is the best a default can do there, while a tier-1 speed module you
 * cannot craft yet has an honest answer to fall back to. "None" is a complexity of zero — you have
 * empty slots at the crash site — so it wins for as long as no real module is unlocked.
 *
 * Takes the cheapest-first list {@link modulesIn} returns: the last module in it you can reach is
 * the best one you can reach, and one nothing unlocks (complexity `Infinity`) is never reached.
 */
export function defaultModule(modules: ModuleMatch[], progress: number): ModuleMatch | undefined {
  return modules.findLast((match) => complexityOf(match) <= progress);
}

/**
 * The beacon a cell row builds when its speed modules overflow the machine: the vanilla two-slot
 * one, because it is the one every pack has and the one a factory is actually tiled with.
 *
 * Not a choice yet, and deliberately not one that follows the progress slider: a bigger beacon is
 * fewer beacons for the same modules and so a *better* transmission strength, which would make the
 * answer jump about as the slider moved past `bob-beacon-2`. When the row grows a beacon picker
 * this is where its default belongs; until then it is the conservative reading — the most beacons
 * a request needs, and so the worst discount.
 */
export const rowBeacon: Beacon | undefined =
  staticData.beacons['beacon'] ?? Object.values(staticData.beacons ?? {})[0];

/** The module family a cell row's speed count spends; see `CellEntry.speedModules`. */
export const SPEED_CATEGORY = 'speed';

/**
 * Which module a family means right now: the one the header pinned, or — where it pinned nothing —
 * whatever {@link defaultModule} makes of where the player is. `undefined` either way for none,
 * which is both what `null` means and what the early game defaults to.
 */
export function chosenModule(
  choice: ModuleChoice,
  category: string,
  progress: number,
): ModuleId | undefined {
  const picked = choice[category];
  if (picked !== undefined) return picked ?? undefined;
  return defaultModule(modulesIn(category), progress)?.id;
}

/**
 * Which module the user wants reached for in each category, keyed by {@link ModuleCategory}`.id`.
 * Three states, and they are all different: a module id, `null` for none — no modules of this
 * family, whatever the progress — and absent for a category nobody has decided, which follows the
 * progress slider through {@link defaultModule}.
 */
export type ModuleChoice = Record<string, ModuleId | null>;
