import type { Product, ProductAmount, ResourceId } from '../types.ts';
import type { ActiveProcess } from './types.ts';

/**
 * The expected number of items a product yields per cycle. Probabilistic
 * products contribute `probability × amount`; ranged amounts use the midpoint.
 *
 * This is the single place that decides "rate semantics" — swap it for
 * worst-case/max if we ever need peak rather than average throughput.
 */
export function productRate(product: Product): number {
  return product.probability * amountValue(product.amount);
}

function amountValue(amount: ProductAmount): number {
  return 'fixed' in amount ? amount.fixed : (amount.min + amount.max) / 2;
}

/** A signed per-second rate for a single recipe stack (one ingredient or product). */
export interface StackRate {
  resource: ResourceId;
  /** Negative for ingredients, positive for products. */
  rate: number;
}

/**
 * Per-stack signed per-second rates for ONE running building (`ALGORITHM.md`
 * §2): ingredients negative, products positive, NOT summed. Keeping stacks
 * separate lets the materials readout show gross consumed/produced for an item
 * that is both consumed and produced (the cycle visibility in §6).
 *
 * `multipliers` scale modifiable stacks; resources listed in `unmod`
 * (catalysts) skip the input/output multiplier.
 */
export function stackRates(ap: ActiveProcess): StackRate[] {
  const { recipe } = ap;
  const duration = recipe.duration * (ap.multipliers?.duration ?? 1);
  const inputMult = ap.multipliers?.inputs ?? 1;
  const outputMult = ap.multipliers?.outputs ?? 1;
  const unmod = new Set(ap.unmod ?? []);

  const out: StackRate[] = [];
  for (const ing of recipe.ingredients) {
    const mult = unmod.has(ing.resource) ? 1 : inputMult;
    out.push({ resource: ing.resource, rate: -(mult * ing.amount) / duration });
  }
  for (const prod of recipe.products) {
    const mult = unmod.has(prod.resource) ? 1 : outputMult;
    out.push({ resource: prod.resource, rate: (mult * productRate(prod)) / duration });
  }
  return out;
}

/**
 * Net signed per-second rates for ONE running building, with stacks for the
 * same resource summed. This is the netted form used for a process's matrix
 * column (an item consumed and produced within one process is netted to
 * `-in + out`).
 */
export function processRates(ap: ActiveProcess): Map<ResourceId, number> {
  const rates = new Map<ResourceId, number>();
  for (const { resource, rate } of stackRates(ap)) {
    rates.set(resource, (rates.get(resource) ?? 0) + rate);
  }
  return rates;
}
