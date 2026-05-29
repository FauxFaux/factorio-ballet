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
