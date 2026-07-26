import {
  CraftingMachinePrototype,
  ItemPrototype,
  type RecipePrototype,
} from 'factorio-raw-types/prototypes';

export const itemKeys = ['localised_name', 'stack_size', 'weight'] as const;

export const recpKeys = [
  'localised_name',
  'category',
  'subgroup',
  'hidden',
  'enabled',
  'ingredients',
  'results',
  'main_product',
  'surface_conditions',
  // time at crafting speed 1
  'energy_required',
] as const;

export const craftingKeys = [
  'localised_name',
  'allowed_module_categories',
  'crafting_categories',
  'energy_source',
  'module_slots',
] as const;

export type Item = Pick<ItemPrototype, (typeof itemKeys)[number]>;

export type Recipe = Pick<RecipePrototype, (typeof recpKeys)[number]>;

export type Crafting = Pick<
  CraftingMachinePrototype,
  (typeof craftingKeys)[number]
>;

export interface Shrunk {
  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
  crafting: Record<string, Crafting>;
}
