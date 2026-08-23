export interface StaticData {
  recipes: Record<string, Recipe>;
  resources: Record<ResourceId, Resource>;
  machines: Record<MachineId, Machine>;
}

export type ResourceId = `item:${string}` | `fluid:${string}`;

/** A crafting machine's prototype id, e.g. `assembling-machine-2`. */
export type MachineId = string;

export interface Recipe {
  human?: string;
  ingredients: Ingredient[];
  products: Product[];
  duration: number;

  /**
   * The recipe categories this can be crafted in; a machine can run it if it handles any one of
   * them. The game splits these into a primary `category` and `additional_categories`, which
   * matters only for which machine the GUI offers first, so we flatten them.
   */
  categories: string[];

  /**
   * Whether productivity bonuses (from modules or research) apply at all. The game defaults this
   * to off, and most recipes leave it there — 335 of 2330 in the Bob's/Angel's pack allow it — so
   * absent means "productivity does nothing here", not "unknown".
   */
  allowProductivity?: true;

  /**
   * How far through the tech tree you have to be to run this: 0 at the crash site, 1 at the most
   * expensive technology in the pack. `scripts/complexity.ts` derives it, taking the max of the
   * recipe's own unlock cost and the cost of having each ingredient. Absent means unreachable —
   * nothing unlocks it, or every route to an ingredient is a closed cycle — which sorts last.
   */
  complexity?: number;
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

export interface Resource {
  human?: string;
  stackSize?: number;
  /** As `Recipe.complexity`, over the cheapest recipe which produces this; 0 for an ore. */
  complexity?: number;
}

/** Something which can run recipes: an assembler, a furnace, the rocket silo, or the player. */
export interface Machine {
  human?: string;
  /** The prototype type, e.g. `assembling-machine`; `character` is hand crafting. */
  kind: MachineKind;
  /** The recipe categories this machine can run. */
  categories: string[];
  /** Crafts per second, against a recipe whose duration is one second. */
  speed: number;
  moduleSlots?: number;
}

export type MachineKind = 'assembling-machine' | 'furnace' | 'rocket-silo' | 'character';
