import type { MachineMatch } from './data/index.ts';
import {
  allowsEffect,
  BOOST_CATEGORY,
  categoryEffect,
  familyFor,
  moduleFor,
  resourceName,
  staticData,
  takesCategory,
  type BoostEffect,
  type ChosenModules,
} from './data/index.ts';
import { fmt } from './ts.ts';
import type {
  Beacon,
  Ingredient,
  IngredientTemperature,
  Machine,
  MachineId,
  ModuleId,
  Product,
  ProductAmount,
  Recipe,
  ResourceId,
} from './types.ts';

/**
 * What one resource does in one recipe, ready to render: how much per craft, and how fast at the
 * speed it is being quoted at. This file is one recipe in one machine and no more — {@link netRates}
 * is the same arithmetic in the form the solver scales, but the scaling of one recipe against
 * another is `solve/index.ts`, not here.
 */
export interface Flow {
  resource: ResourceId;
  /** Per craft, e.g. `2` or `1–3`. */
  amount: string;
  /** Per second, at the speed asked for, already formatted. */
  rate: string;
  note?: string;
}

/** Crafting speed we quote rates at, until we have building data. */
const CRAFTING_SPEED = 1;

/**
 * Rates this small would read as `0.00`, so a recipe with one anywhere in reach is quoted an extra
 * digit throughout.
 */
const THREE_DP_BELOW = 0.05;

/** How to render a number whose value depends on the machine previewed. */
type Fmt = (value: number) => string;

/** The speed to quote a recipe at in a given machine, or {@link CRAFTING_SPEED} for no machine. */
export function speedOf(machines: MachineMatch[], id: MachineId | undefined): number {
  return machines.find((match) => match.id === id)?.machine.speed ?? CRAFTING_SPEED;
}

/**
 * What the modules in a machine do to it: two multipliers, one on how fast it goes and one on how
 * much comes out. Both are 1 when the slots are empty, so an unmodded machine is {@link NO_EFFECTS}
 * and every rate in {@link recipeFlows} is already quoted at it.
 */
export interface Effects {
  /** Multiplier on `Machine.speed`: three speed module 3s in an assembler is 2.2. */
  speed: number;
  /** Multiplier on everything the recipe produces, ingredients unchanged. That is the whole point. */
  productivity: number;
}

/** An unmodded machine. */
export const NO_EFFECTS: Effects = { speed: 1, productivity: 1 };

/**
 * However negative the modules get, the game will not run a machine slower than a fifth of its
 * rated speed. Reachable here: five bob productivity module 5s is −125%.
 */
const MIN_SPEED = 0.2;

/** What is in a machine's slots: how many of each module, as `modulesFor` names them. */
export type ModuleFill = Record<ModuleId, number>;

/** Every slot of a machine filled with the one module — the loadout worth quoting first. */
export function fillSlots(machine: Machine, module: ModuleId): ModuleFill {
  return machine.moduleSlots ? { [module]: machine.moduleSlots } : {};
}

/**
 * What a machine's modules add up to. Effects are linear in the number of modules and in nothing
 * else — a 10% speed module in two slots is +20%, not 1.1², so three `speed-module-3` come to
 * 1 + 3 × 0.4 = 2.2× and three `productivity-module-3` to +36% output at 0.55× the speed.
 *
 * Two gates, both of which silently make the answer smaller, and neither of which is optional:
 *
 * - a machine only applies the effects in `Machine.allowedEffects`, and ignores the rest rather
 *   than refusing the module — which is why a speed module works in an oil refinery despite the
 *   refinery not allowing the quality malus that comes with it;
 * - productivity does nothing at all unless the *recipe* allows it, and most do not (335 of 2330
 *   here). A productivity module's speed penalty applies regardless, so a machine full of them on
 *   an ordinary recipe is strictly slower and no more productive.
 *
 * And two gates on the fill itself, because a loadout outlives the machine it was chosen for — the
 * progress slider moves and an unpinned row is suddenly a tier 2 assembler with two slots: a module
 * the machine's `allowedModuleCategories` refuses counts for nothing, and only as many as there are
 * slots go in, first named first. Overflow is dropped rather than scaled, so the modules in the
 * machine are the ones the user chose first and the answer never overstates the machine.
 *
 * Modules we did not ingest — efficiency, pollution — are not in `staticData.modules` and count for
 * nothing, which is right for both numbers here. A row's own two counts are {@link laidOutEffects},
 * which is this with a {@link Layout} of modules added on top.
 */
export function moduleEffects(machine: Machine, fill: ModuleFill, recipe: Recipe): Effects {
  return applyBoost(machine, recipe, slotEffects(machine, fill));
}

/** What one loadout adds up to in the machine's own slots, before either of the machine's gates. */
function slotEffects(machine: Machine, fill: ModuleFill): Slots {
  let speed = 0;
  let productivity = 0;
  let free = machine.moduleSlots ?? 0;
  for (const [id, count] of Object.entries(fill)) {
    if (free <= 0) break;
    const module = staticData.modules[id];
    if (!module || !(count > 0)) continue;
    if (!takesCategory(machine, module.category)) continue;
    const fitted = Math.min(count, free);
    free -= fitted;
    speed += (module.speed ?? 0) * fitted;
    productivity += (module.productivity ?? 0) * fitted;
  }
  return { speed, productivity, free };
}

/** The sums from a machine's slots, and how many of them nothing has claimed. */
interface Slots {
  speed: number;
  productivity: number;
  /** Slots left for {@link moduleBoost} to put the row's modules in. */
  free: number;
}

/**
 * The machine's own gates, applied to what is in it plus whatever the row's {@link Boost} adds.
 * Everything both {@link moduleEffects} and {@link laidOutEffects} return comes through here, so
 * the two cannot disagree about which effects a machine bothers with — including the boost's,
 * which a machine ignoring an effect ignores exactly as it ignores a module carrying it in its own
 * slots. Both of the boost's numbers land, because a module is both of them wherever it sits: a
 * productivity module in a spare slot is a speed malus as well as a yield.
 */
function applyBoost(machine: Machine, recipe: Recipe, slots: Slots, ...boosts: Boost[]): Effects {
  let speed = slots.speed + boosts.reduce((total, boost) => total + boost.speed, 0);
  let productivity = slots.productivity + boosts.reduce((total, b) => total + b.productivity, 0);

  if (!allowsEffect(machine, 'speed')) speed = 0;
  if (!allowsEffect(machine, 'productivity') || !recipe.allowProductivity) productivity = 0;

  return { speed: Math.max(MIN_SPEED, 1 + speed), productivity: 1 + productivity };
}

/**
 * A row's request for modules of one family, laid out over the machine and the beacons it took to
 * hold the rest. The user states one number — how many of them they want this machine feeling — and
 * this is where that becomes a factory: the machine's own slots first, because they are free, and
 * then beacons, which are not.
 *
 * One family of the two a row asks for; {@link moduleLayout} is both of them over one machine. The
 * beacons are where the families part company: a beacon transmits speed and refuses productivity
 * outright, which is why only the speed half of a row ever builds any.
 *
 * The beacon arithmetic is `docs/beacons.wiki`'s: each of `n` beacons transmits
 * `distributionEffectivity / sqrt(n)` of what is in it, so `n` full beacons come to `1.5 × sqrt(n)`
 * times one beacon's contents and the returns diminish from the second one on. That the game's own
 * `profile` table says the same is checked by the ingest, not assumed.
 *
 * Everything is one kind of beacon and one kind of module, because a cell row is not a floor plan:
 * where the beacons are, which machines they overlap and whether the last one is worth building are
 * questions this app cannot see. What it can do is not overstate the answer, so the last beacon is
 * built whether or not it is full — 5 modules over 2-slot beacons is three beacons and the penalty
 * of three, not of two and a half.
 */
export interface Boost {
  /** The module being asked for; absent when none is chosen, or nothing here would take it. */
  module?: ModuleId;
  /** How many the user asked for, whether or not anything could hold them. */
  wanted: number;
  /** How many went into the machine's own free slots. */
  inMachine: number;
  /** How many went into beacons. */
  inBeacons: number;
  /** How many beacons that took, each holding as many as it can before the next one is built. */
  beacons: number;
  /** What one module in one of those beacons is worth against one in the machine. */
  transmission: number;
  /** The speed fraction the lot of it adds: 1.2 is "+120%", before the machine's own gates. */
  speed: number;
  /** The productivity fraction it adds, on the same terms; a speed module's is zero. */
  productivity: number;
}

/** Nothing asked for and nothing to show for it. */
export const NO_BOOST: Boost = {
  wanted: 0,
  inMachine: 0,
  inBeacons: 0,
  beacons: 0,
  transmission: 0,
  speed: 0,
  productivity: 0,
};

/**
 * How one family's `wanted` modules are laid out; see {@link Boost}. `wanted` absent is as many as
 * the spare slots hold and no beacons, which {@link moduleLayout} is what decides for each family.
 *
 * Three ways of asking for something which cannot happen, all of which end up quoting less rather
 * than more: a machine with no slots at all receives nothing, from a beacon either (the game's
 * rule, and the reason a pump cannot be beaconed); a machine which refuses the module's category
 * holds none of them itself, though beacons will still reach it, because a beacon's own whitelist
 * is what governs what goes in a beacon; and a beacon which will not take the module leaves the
 * overflow nowhere to go, so it is dropped rather than pretended into the machine — which is every
 * productivity module past the machine's own slots, since no beacon transmits productivity.
 */
export function moduleBoost(
  machine: Machine,
  free: number,
  module: ModuleId | undefined,
  wanted: number | undefined,
  beacon: Beacon | undefined,
): Boost {
  const found = module === undefined ? undefined : staticData.modules[module];
  /* Not "no slots left": no slots at all. A beacon transmits to machines which take modules, so a
   * machine which takes none is out of reach of both halves of this. */
  if (!module || !found || !machine.moduleSlots) return NO_BOOST;
  /* What the family is reached for, which is the beacon's question and not the machine's: a beacon
   * takes the modules whose effect it transmits, and what one does once it is in there is both of
   * its numbers whichever of them it was picked for. */
  const effect = categoryEffect(found.category);

  const slots = takesCategory(machine, found.category) ? Math.max(0, free) : 0;
  const asked = wanted ?? slots;
  const inMachine = Math.min(asked, slots);
  const spare = asked - inMachine;

  /* What the beacon will hold of this, which is its own two questions and not the machine's: a
     beacon which refuses the category takes none, and one whose `allowedEffects` leaves out the
     effect would transmit nothing even if it did. */
  const holds =
    beacon &&
    beacon.moduleSlots > 0 &&
    takesCategory(beacon, found.category) &&
    (beacon.allowedEffects?.includes(effect) ?? true)
      ? beacon.moduleSlots
      : 0;
  const inBeacons = holds ? spare : 0;
  const beacons = holds ? Math.ceil(inBeacons / holds) : 0;
  const transmission = beacons ? (beacon?.distributionEffectivity ?? 0) / Math.sqrt(beacons) : 0;
  /* How many modules the machine ends up feeling, a beaconed one being worth its transmission. Both
     of the module's numbers are scaled by it: a family is picked for one effect, but a module is
     all of what it does, and it is `applyBoost` which decides which of them this machine keeps. */
  const felt = inMachine + inBeacons * transmission;

  return {
    module,
    wanted: asked,
    inMachine,
    inBeacons,
    beacons,
    transmission,
    speed: felt * (found.speed ?? 0),
    productivity: felt * (found.productivity ?? 0),
  };
}

/**
 * How many modules of each family a row wants. The two are asked differently on purpose, because
 * the game answers them differently: productivity can only ever be in the machine's own slots, so
 * that number is capped there, while speed goes wherever it fits and beacons are how it gets there.
 * Absent is auto for either, and the two autos are not the same rule; see {@link moduleLayout}.
 */
export interface ModuleWants {
  productivity?: number;
  speed?: number;
}

/** Where a row's modules ended up: one {@link Boost} per effect, plus the slots they had. */
export interface Layout {
  productivity: Boost;
  speed: Boost;
  /** The machine's slots which the row's own loadout left free — what the two were laid out over. */
  slots: number;
  /**
   * Which family each side is spending, which is the machine's answer and not the row's: a farm
   * takes the agricultural modules where an assembler takes the productivity ones. See `moduleFor`.
   */
  families: Record<BoostEffect, string>;
  /**
   * Whether asking for modules of each effect could do anything here at all — which is not the same
   * as their coming to nothing today. A number the user cannot spend is a box the row does not draw
   * (see `ModuleBoxes`), so this is the difference between "no modules yet" and "not here, ever":
   * an offshore pump has no slots, so neither a module nor a beacon reaches it; a machine whose
   * `allowedEffects` leaves an effect out would ignore one that did; and productivity needs the
   * recipe's permission on top of both.
   */
  reaches: Record<BoostEffect, boolean>;
}

/** A machine with nothing in it, and nowhere to put anything. */
export const NO_LAYOUT: Layout = {
  productivity: NO_BOOST,
  speed: NO_BOOST,
  slots: 0,
  families: BOOST_CATEGORY,
  reaches: { productivity: false, speed: false },
};

/**
 * Both families over one machine: productivity into its slots, speed into whatever they leave, and
 * beacons for the rest of the speed. The order is not a preference but the arithmetic — a slot is
 * the only place a productivity module can be, so a slot spent on speed is one productivity cannot
 * have, while speed has beacons to fall back on and loses nothing by being asked second.
 *
 * The two autos differ because the two questions do. Productivity's is "as many as will fit", which
 * is the standard build and the only thing a slot can be worth on a recipe which pays for it —
 * unless it does not {@link Layout.reaches} the machine at all, where it is none rather than a
 * speed malus bought for nothing. Speed's is whatever slots are still empty afterwards and no beacons,
 * which is the machine you would put together without thinking about it.
 *
 * A number the user typed is honoured either way, and typing one into the speed box does not take a
 * slot back off productivity: a beaconed speed module reaches a machine whose own slots are full,
 * which is exactly what beacons are for, and it is `docs/beacons.wiki`'s discount that pays for it.
 *
 * Which module either side is spending is `moduleFor`'s, not the header's alone: more than one
 * family is picked for productivity, and which of them a machine reaches for is a fact about the
 * machine — Angel's farms take the agricultural modules, an assembler the ordinary ones.
 */
export function moduleLayout(
  machine: Machine,
  free: number,
  recipe: Recipe,
  modules: ChosenModules,
  wants: ModuleWants,
  beacon: Beacon | undefined,
): Layout {
  const slots = Math.max(0, free);
  /* What could ever reach this machine. Not "what is in it": the row asks for modules it does not
     have yet all the time, and the slots are the point of asking. A machine with none at all is out
     of reach of beacons too, which is the game's rule and the reason a pump takes nothing. */
  const reaches = {
    speed: !!machine.moduleSlots && allowsEffect(machine, 'speed'),
    productivity:
      !!machine.moduleSlots && allowsEffect(machine, 'productivity') && !!recipe.allowProductivity,
  };
  const auto = reaches.productivity ? slots : 0;
  const productivity = moduleBoost(
    machine,
    slots,
    moduleFor(machine, 'productivity', modules),
    Math.min(wants.productivity ?? auto, slots),
    beacon,
  );
  const speed = moduleBoost(
    machine,
    slots - productivity.inMachine,
    moduleFor(machine, 'speed', modules),
    wants.speed,
    beacon,
  );
  return {
    productivity,
    speed,
    slots,
    reaches,
    /* What each box is drawing, chosen or not: the module itself where there is one, and otherwise
       the family this machine would have used, so an empty box still says which. */
    families: {
      productivity: familyFor(machine, 'productivity'),
      speed: familyFor(machine, 'speed'),
    },
  };
}

/** A machine running a recipe with `fill` in its slots and a {@link Layout} of modules on top. */
export function laidOutEffects(
  machine: Machine,
  fill: ModuleFill | undefined,
  recipe: Recipe,
  modules: ChosenModules,
  wants: ModuleWants,
  beacon: Beacon | undefined,
): { effects: Effects; layout: Layout } {
  const slots = slotEffects(machine, fill ?? {});
  const layout = moduleLayout(machine, slots.free, recipe, modules, wants, beacon);
  return {
    effects: applyBoost(machine, recipe, slots, layout.productivity, layout.speed),
    layout,
  };
}

/**
 * Signed net rates per second for one machine running this recipe: an ingredient negative, a
 * product positive, and a resource on both sides netted down to what actually crosses the machine's
 * edge. This is the unit the solver scales — one row of a cell, at one machine, with one loadout —
 * where {@link recipeFlows} is the same arithmetic kept in stacks and formatted for a card.
 *
 * Netting is where the catalyst rule shows up: a resource on both sides of one recipe is one
 * number here, and productivity has already been settled per product by {@link productAmount}
 * before the two sides meet — the bonus is paid on what the recipe makes, never on what it merely
 * hands back. What the game cannot tell us is the *other* catalyst, the one that goes round a cycle
 * of two recipes rather than one; a solver which closes cycles will have to think about it again.
 */
export function netRates(recipe: Recipe, speed: number, effects: Effects): Map<ResourceId, number> {
  const crafts = (speed * effects.speed) / recipe.duration;
  const rates = new Map<ResourceId, number>();
  const add = (resource: ResourceId, rate: number) =>
    rates.set(resource, (rates.get(resource) ?? 0) + rate);
  for (const { resource, amount } of recipe.ingredients) add(resource, -amount * crafts);
  for (const product of recipe.products) {
    add(product.resource, productAmount(product, effects.productivity) * crafts);
  }
  return rates;
}

/**
 * What one craft yields of one product, on average, at a productivity multiplier: what it rolls,
 * plus the bonus on the part of it the recipe actually made. `Product.ignoredByProductivity` is the
 * rest — the catalyst it borrowed — and it can exceed the whole result, which is the game saying
 * the bonus is paid on nothing at all rather than on a negative amount.
 *
 * Chance is on the roll, and the bonus rides on it: a 20% result at +36% productivity is 20% of a
 * bigger result, not a better chance at the same one.
 */
export function productAmount(product: Product, productivity: number): number {
  const amount = averageAmount(product.amount);
  const paid = Math.max(0, amount - (product.ignoredByProductivity ?? 0));
  return (amount + paid * (productivity - 1)) * product.probability;
}

/**
 * Every flow of a recipe at one machine's speed, in and out.
 *
 * Scaled numbers land on far fewer round values than the 1× baseline does, and {@link fmt}'s
 * precision moves with the magnitude, so the numbers changed width — and a card's summary rewrapped
 * — as the pointer moved along the machine list. The precision is decided for the recipe as a whole
 * instead, from every machine it could run in, so nothing moves whichever machine is quoted.
 */
export function recipeFlows(
  recipe: Recipe,
  machines: MachineMatch[],
  speed: number,
): { ins: Flow[]; outs: Flow[] } {
  const crafts = speed / recipe.duration;
  const digits = rateDigits(recipe, machines);
  const rate = (value: number) => value.toFixed(digits);
  return {
    ins: recipe.ingredients.map((ingredient) => ingredientFlow(ingredient, crafts, rate)),
    outs: recipe.products.map((product) => productFlow(product, crafts, rate)),
  };
}

export function flowTitle(flow: Flow): string {
  const note = flow.note ? `, ${flow.note}` : '';
  return `${resourceName(flow.resource)}: ${flow.amount} per craft${note}`;
}

/**
 * How many decimals this recipe's rates are quoted at, decided once for the card: three if any flow
 * could fall below {@link THREE_DP_BELOW} on any machine it can run on — including the 1× baseline —
 * and two otherwise. Deciding it per number instead let a card wrap to two lines at three decimals
 * and back to one at two.
 */
export function rateDigits(recipe: Recipe, machines: MachineMatch[]): number {
  const slowest = Math.min(CRAFTING_SPEED, ...machines.map(({ machine }) => machine.speed));
  const amounts = [
    ...recipe.ingredients.map((ingredient) => ingredient.amount),
    ...recipe.products.map((product) => productAmount(product, 1)),
  ].filter((amount) => amount > 0);
  const smallest = (Math.min(...amounts) * slowest) / recipe.duration;
  return smallest < THREE_DP_BELOW ? 3 : 2;
}

function ingredientFlow(ingredient: Ingredient, crafts: number, rate: Fmt): Flow {
  return {
    resource: ingredient.resource,
    amount: fmt(ingredient.amount),
    rate: rate(ingredient.amount * crafts),
    note: ingredient.temperature && temperatureNote(ingredient.temperature),
  };
}

function productFlow(product: Product, crafts: number, rate: Fmt): Flow {
  const expected = productAmount(product, 1);
  return {
    resource: product.resource,
    amount: amountLabel(product.amount),
    rate: rate(expected * crafts),
    note: product.probability === 1 ? undefined : `${fmt(product.probability * 100)}%`,
  };
}

/** What a `{min,max}` result is worth on average, which is what a rate is quoted from. */
export function averageAmount(amount: ProductAmount): number {
  return 'fixed' in amount ? amount.fixed : (amount.min + amount.max) / 2;
}

function amountLabel(amount: ProductAmount): string {
  return 'fixed' in amount ? fmt(amount.fixed) : `${fmt(amount.min)}–${fmt(amount.max)}`;
}

function temperatureNote(temperature: IngredientTemperature): string {
  if ('fixed' in temperature) return `at ${fmt(temperature.fixed)}°C`;
  if ('min' in temperature && 'max' in temperature)
    return `${fmt(temperature.min)}–${fmt(temperature.max)}°C`;
  if ('min' in temperature) return `≥${fmt(temperature.min)}°C`;
  return `≤${fmt(temperature.max)}°C`;
}
