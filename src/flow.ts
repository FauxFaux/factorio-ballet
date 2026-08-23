import type { MachineMatch } from './data.ts';
import { resourceName } from './data.ts';
import { fmt } from './ts.ts';
import type {
  Ingredient,
  IngredientTemperature,
  MachineId,
  Product,
  ProductAmount,
  Recipe,
  ResourceId,
} from './types.ts';

/**
 * What one resource does in one recipe, ready to render: how much per craft, and how fast at the
 * speed it is being quoted at. The arithmetic between a `Recipe` and a card, and nothing else — no
 * cell, no solver, no scaling of one recipe against another.
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
