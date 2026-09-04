import type { MachineMatch } from './data/machines.ts';
import { resourceName } from './data/index.ts';
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
import type { Effects } from './module-effects.ts';

export {
  fillSlots,
  laidOutEffects,
  moduleBoost,
  moduleEffects,
  moduleLayout,
  NO_BOOST,
  NO_EFFECTS,
  NO_LAYOUT,
} from './module-effects.ts';
export type { Boost, Effects, Layout, ModuleFill, ModuleWants } from './module-effects.ts';

export interface Flow {
  resource: ResourceId;
  amount: string;
  rate: string;
  note?: string;
}

const CRAFTING_SPEED = 1;
const THREE_DP_BELOW = 0.05;
type Fmt = (value: number) => string;

export function speedOf(machines: MachineMatch[], id: MachineId | undefined): number {
  return machines.find((match) => match.id === id)?.machine.speed ?? CRAFTING_SPEED;
}

export function netRates(recipe: Recipe, speed: number, effects: Effects): Map<ResourceId, number> {
  const { inputs, outputs } = directionalRates(recipe, speed, effects);
  const rates = new Map<ResourceId, number>();
  const add = (resource: ResourceId, rate: number) =>
    rates.set(resource, (rates.get(resource) ?? 0) + rate);
  for (const [resource, rate] of inputs) add(resource, -rate);
  for (const [resource, rate] of outputs) add(resource, rate);
  return rates;
}

/** Gross rates on each side, before a returned tool or catalyst is netted. */
export function directionalRates(
  recipe: Recipe,
  speed: number,
  effects: Effects,
): { inputs: Map<ResourceId, number>; outputs: Map<ResourceId, number> } {
  const crafts = (speed * effects.speed) / recipe.duration;
  const inputs = new Map<ResourceId, number>();
  const outputs = new Map<ResourceId, number>();
  const add = (rates: Map<ResourceId, number>, resource: ResourceId, rate: number) =>
    rates.set(resource, (rates.get(resource) ?? 0) + rate);
  for (const { resource, amount } of recipe.ingredients) add(inputs, resource, amount * crafts);
  for (const product of recipe.products) {
    add(outputs, product.resource, productAmount(product, effects.productivity) * crafts);
  }
  return { inputs, outputs };
}

export function productAmount(product: Product, productivity: number): number {
  const amount = averageAmount(product.amount);
  const paid = Math.max(0, amount - (product.ignoredByProductivity ?? 0));
  return (amount + paid * (productivity - 1)) * product.probability;
}

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
