import type { MachineMatch } from './data.ts';
import { allowsEffect, resourceName, staticData } from './data.ts';
import { fmt } from './ts.ts';
import type {
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
 * another is `solve.ts`, not here.
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
 * Modules we did not ingest — efficiency, pollution — are not in `staticData.modules` and count for
 * nothing, which is right for both numbers here. Beacons are not modelled at all yet.
 */
export function moduleEffects(machine: Machine, fill: ModuleFill, recipe: Recipe): Effects {
  let speed = 0;
  let productivity = 0;
  for (const [id, count] of Object.entries(fill)) {
    const module = staticData.modules[id];
    if (!module || !count) continue;
    speed += (module.speed ?? 0) * count;
    productivity += (module.productivity ?? 0) * count;
  }

  if (!allowsEffect(machine, 'speed')) speed = 0;
  if (!allowsEffect(machine, 'productivity') || !recipe.allowProductivity) productivity = 0;

  return { speed: Math.max(MIN_SPEED, 1 + speed), productivity: 1 + productivity };
}

/**
 * Signed net rates per second for one machine running this recipe: an ingredient negative, a
 * product positive, and a resource on both sides netted down to what actually crosses the machine's
 * edge. This is the unit the solver scales — one row of a cell, at one machine, with one loadout —
 * where {@link recipeFlows} is the same arithmetic kept in stacks and formatted for a card.
 *
 * Netting is where the catalyst problem will land. `productivity` is paid here on the whole of a
 * product, and the game does not pay it on the part of one which came back round as an ingredient;
 * with the multiplier at 1 the two agree, which is every rate this app quotes today.
 */
export function netRates(recipe: Recipe, speed: number, effects: Effects): Map<ResourceId, number> {
  const crafts = (speed * effects.speed) / recipe.duration;
  const rates = new Map<ResourceId, number>();
  const add = (resource: ResourceId, rate: number) =>
    rates.set(resource, (rates.get(resource) ?? 0) + rate);
  for (const { resource, amount } of recipe.ingredients) add(resource, -amount * crafts);
  for (const product of recipe.products) {
    const expected = averageAmount(product.amount) * product.probability;
    add(product.resource, expected * effects.productivity * crafts);
  }
  return rates;
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
    ...recipe.products.map((product) => averageAmount(product.amount) * product.probability),
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
  const expected = averageAmount(product.amount) * product.probability;
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
