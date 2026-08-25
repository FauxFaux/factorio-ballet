import type {
  Beacon,
  BeaconId,
  Belt,
  BeltId,
  Effect,
  Machine,
  MachineId,
  Module,
  ModuleId,
  Recipe,
  ResourceId,
  StaticData,
} from './types.ts';
const staticDataJson = await import('./assets/static.json');

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

/**
 * Whether a machine applies one of the module effects. Absent means no restriction — see
 * `Machine.allowedEffects`, and note that the game ignores a disallowed effect rather than refusing
 * the module carrying it.
 */
export function allowsEffect(machine: Machine, effect: Effect): boolean {
  return machine.allowedEffects?.includes(effect) ?? true;
}

/**
 * Whether a machine or a beacon will take a module of this category at all; absent means all, and
 * that absence is the only home Angel's bio-yield modules have — every machine here which names a
 * list names the same six categories, all of them except that one.
 */
export function takesCategory(holder: Machine | Beacon, category: string): boolean {
  return holder.allowedModuleCategories?.includes(category) ?? true;
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
    if (!takesCategory(machine, module.category)) continue;
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
  effect: BoostEffect;
}

/**
 * The two effects this app models, which are the two things a family of modules is reached for and
 * the two a cell row asks for a count of; see `CellEntry.productivityModules`.
 */
export type BoostEffect = 'speed' | 'productivity';

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

/**
 * What a family of modules is picked *for*, by its category id. An unknown category cannot happen
 * for a module in the data — {@link moduleCategories} is built from the categories there are — so
 * the fallback is only the type's business.
 */
export function categoryEffect(category: string): BoostEffect {
  return moduleCategories.find(({ id }) => id === category)?.effect ?? 'speed';
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

/** The two module families a cell row asks for; see `moduleLayout` in `src/flow.ts`. */
export const SPEED_CATEGORY = 'speed';
export const PRODUCTIVITY_CATEGORY = 'productivity';

/**
 * Which family a row spends for each effect. The dataset's own `angels-bio-yield` is productivity
 * too, but it is a family for one kind of machine rather than an alternative to the productivity
 * modules, so it is the header's picker and not a row's choice.
 */
export const BOOST_CATEGORY: Record<BoostEffect, string> = {
  speed: SPEED_CATEGORY,
  productivity: PRODUCTIVITY_CATEGORY,
};

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

/** Which module the header means by each family, keyed by category id; see {@link chosenModules}. */
export type ChosenModules = Record<string, ModuleId | undefined>;

/**
 * Every family resolved once against the header's choices: a row states how many modules it wants
 * for an effect, never which module or even which family, so this is where "a productivity module"
 * becomes a tier. Resolved for the app rather than per row, because it is one decision and every
 * row spends it — {@link moduleFor} is the per-machine half, which family of the ones here.
 */
export function chosenModules(choice: ModuleChoice, progress: number): ChosenModules {
  return Object.fromEntries(
    moduleCategories.map(({ id }) => [id, chosenModule(choice, id, progress)]),
  );
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

/** The families picked for one effect, in the order {@link moduleCategories} has them. */
function familiesOf(effect: BoostEffect): ModuleCategory[] {
  return moduleCategories.filter((category) => category.effect === effect);
}

/** What one module is worth for an effect: the number the choice between two families turns on. */
function worthOf(id: ModuleId | undefined, effect: BoostEffect): number {
  return (id === undefined ? 0 : (staticData.modules[id]?.[effect] ?? 0)) || 0;
}

/**
 * Which module a machine would actually reach for, for one effect: the best of what the header has
 * chosen, out of the families this machine will take.
 *
 * More than one family can be picked for the same effect — `productivity` and Angel's
 * `angels-bio-yield` both are — and which of them a row spends is a fact about the machine and not
 * about the row. Angel's farms name no `allowed_module_categories` at all, so they take ordinary
 * productivity modules as well as the bio-yield ones a farm is actually for; every other machine
 * which names a list leaves bio-yield out. So neither "the productivity family" nor "the one the
 * machine allows" answers it, and what does is which module is worth more here: bio-yield is pure
 * yield at up to +50%, against +20% and a speed malus, so a farm gets the agricultural modules and
 * an assembler the only ones it can take.
 *
 * The speed malus is not weighed against the yield, deliberately — that is a judgement about a
 * factory, and the row has a speed box of its own to make it with.
 *
 * A machine which refuses every family that has a module is still worth answering for, because a
 * beacon reaches a machine which will not hold the module itself; {@link takesCategory} decides
 * what goes in the slots, and this only decides which module is being talked about.
 */
export function moduleFor(
  machine: Machine,
  effect: BoostEffect,
  chosen: ChosenModules,
): ModuleId | undefined {
  const named = familiesOf(effect).filter(({ id }) => chosen[id] !== undefined);
  const takes = named.filter((category) => takesCategory(machine, category.id));
  const pool = takes.length > 0 ? takes : named;
  return pool
    .map(({ id }) => chosen[id])
    .toSorted((a, b) => worthOf(b, effect) - worthOf(a, effect))[0];
}

/**
 * Which family stands for an effect in this machine when the header has chosen no module at all —
 * the icon a row's box draws with its lights out. {@link moduleFor}'s question asked of the
 * dataset rather than of the header: the best a family could be worth here, chosen or not.
 */
export function familyFor(machine: Machine | undefined, effect: BoostEffect): string {
  const families = familiesOf(effect);
  const takes = machine
    ? families.filter((category) => takesCategory(machine, category.id))
    : families;
  const best = (category: ModuleCategory) =>
    Math.max(0, ...modulesIn(category.id).map(({ module }) => module[effect] ?? 0));
  return (
    (takes.length > 0 ? takes : families).toSorted((a, b) => best(b) - best(a))[0]?.id ??
    BOOST_CATEGORY[effect]
  );
}

/** What a family is called on a row: the picker's own name for it, `agricultural` and all. */
export function categoryName(category: string): string {
  return moduleCategories.find(({ id }) => id === category)?.human ?? category;
}

/**
 * Which module the user wants reached for in each category, keyed by {@link ModuleCategory}`.id`.
 * Three states, and they are all different: a module id, `null` for none — no modules of this
 * family, whatever the progress — and absent for a category nobody has decided, which follows the
 * progress slider through {@link defaultModule}.
 */
export type ModuleChoice = Record<string, ModuleId | null>;
