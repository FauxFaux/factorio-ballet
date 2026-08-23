import * as z from 'zod/mini';

export function arr<T>(v: T[]): T[] {
  return Object.keys(v).length === 0 ? [] : v;
}

const resourceType = z.union([z.literal('item'), z.literal('fluid')]);

export const RIngredient = z.strictObject({
  type: resourceType,
  name: z.string(),
  amount: z.number().check(z.nonnegative()),
  temperature: z.optional(z.number()),
  minimum_temperature: z.optional(z.number()),
  maximum_temperature: z.optional(z.number()),

  ignored_by_stats: z.optional(z.unknown()),
  fluidbox_index: z.optional(z.unknown()),
});

export type RIngredient = z.infer<typeof RIngredient>;

export const RProduct = z.strictObject({
  type: resourceType,
  name: z.string(),
  amount: z.optional(z.number().check(z.nonnegative())),
  amount_min: z.optional(z.number().check(z.nonnegative())),
  amount_max: z.optional(z.number().check(z.nonnegative())),

  probability: z.optional(z.number()),
  temperature: z.optional(z.number()),
  ignored_by_productivity: z.optional(z.number()),

  ignored_by_stats: z.optional(z.unknown()),
  fluidbox_index: z.optional(z.unknown()),
  show_details_in_recipe_tooltip: z.optional(z.unknown()),
});

export type RProduct = z.infer<typeof RProduct>;

/**
 * Whether a result is actually produced. `probability: 0` is how the game writes "and nothing comes
 * out": the angels void sinks name a hidden marker item (`angels-water-void`,
 * `angels-chemical-void`) so the recipe has a result at all, then never roll it. Those 93 recipes
 * are the only place in the dump the field is zero, and the marker is their sole result, so a
 * clarifier is honestly a recipe with no products — a sink. Zero *amounts* are not used this way.
 */
export function isProduced(p: RProduct): boolean {
  return p.probability !== 0;
}

export const RLocale = z.strictObject({
  names: z.record(z.string(), z.string()),
  descriptions: z.optional(z.record(z.string(), z.string())),
});

export type RLocale = z.infer<typeof RLocale>;
