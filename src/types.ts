export interface StaticData {
  recipes: Record<string, Recipe>;
  resources: Record<ResourceId, Resource>;
}

export type ResourceId = `item:${string}` | `fluid:${string}`;

export interface Recipe {
  human?: string;
  ingredients: Ingredient[];
  products: Product[];
  duration: number;

  // building details
}

export interface Ingredient {
  resource: ResourceId;
  amount: number;
  temperature?: IngredientTemperature;
}

export interface Product {
  resource: ResourceId;
  amount: ProductAmount;
  probability: number;
}

export type ProductAmount = { fixed: number } | { min: number; max: number };

export type IngredientTemperature =
  | { fixed: number }
  | { min: number; max: number }
  | { min: number }
  | { max: number };

interface Resource {
  human?: string;
  stackSize?: number;
}
