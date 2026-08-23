export interface StaticData {
  recipes: Record<string, Recipe>;
  resources: Record<ResourceId, Resource>;
  machines: Record<MachineId, Machine>;

  /**
   * The modules worth modelling: every one which changes how fast a machine runs or how much comes
   * out of it. Efficiency and pollution modules are dropped, because nothing here costs power or
   * makes smoke yet. Keyed by bare prototype id, which is also the id of the item you craft — a
   * module is an item, so its name, stack size and complexity are already in `resources`.
   */
  modules: Record<ModuleId, Module>;

  /**
   * Every item some technology asks for as a research ingredient, cheapest `complexity` first. They
   * are the only readable landmarks on the complexity scale — "past yellow science" is how a player
   * describes a save, where "58%" means nothing — so the app labels its progress slider with them.
   * Which items those are is game data, hence a list here rather than a guess in the UI.
   */
  sciencePacks: ResourceId[];
}

export type ResourceId = `item:${string}` | `fluid:${string}`;

/** A crafting machine's prototype id, e.g. `assembling-machine-2`. */
export type MachineId = string;

/** A module's prototype id, e.g. `speed-module-3`; the same id as the item you craft. */
export type ModuleId = string;

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
   * Not a `data.raw.recipe` at all, but something the game does which behaves like one: an offshore
   * pump conjuring fluid from the tile it stands on, or a mining drill working an ore patch. Built
   * by `scripts/synthetic.ts`, and flagged here so the UI can say so rather than passing it off as
   * a recipe you could look up in the game.
   */
  synthetic?: true;

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

/**
 * Something which can run recipes: an assembler, a furnace, the rocket silo, the player, or — for
 * the synthetic recipes — a mining drill or an offshore pump.
 */
export interface Machine {
  human?: string;
  /** The prototype type, e.g. `assembling-machine`; `character` is hand crafting. */
  kind: MachineKind;
  /** The item which places it, if any; the character has none. Bare prototype id, as items are. */
  item?: string;
  /** The recipe categories this machine can run. */
  categories: string[];
  /** Crafts per second, against a recipe whose duration is one second. */
  speed: number;
  moduleSlots?: number;

  /**
   * Which module effects this machine actually applies, from the game's `allowed_effects`. **Absent
   * means all of them** — 22 of the 182 here say nothing, the mining drills among them — so this
   * is a restriction to check for, never a list to enumerate from.
   *
   * The game ignores a disallowed effect rather than refusing the module: a speed module's quality
   * malus is not in an oil refinery's list, and speed modules go in refineries all the same. So an
   * effect missing here zeroes that one number, and leaves the module's other effects alone.
   */
  allowedEffects?: Effect[];

  /**
   * Which `Module.category` values this machine will take, from the game's
   * `allowed_module_categories`; absent means all. Unlike {@link allowedEffects} this one does
   * refuse the module outright. Every machine here which names a list names the same six
   * categories, all of them except `angels-bio-yield`; the seventeen which name none are Angel's
   * twelve farms and bio buildings — the only home those modules have — and the slotless character
   * and pumps.
   */
  allowedModuleCategories?: string[];
}

export type MachineKind =
  | 'assembling-machine'
  | 'furnace'
  | 'rocket-silo'
  | 'character'
  | 'mining-drill'
  | 'offshore-pump';

/**
 * One of the five things a module does to the machine it sits in. We model the two which change
 * throughput; `consumption` and `pollution` are the costs of doing so, and `quality` is a game mode
 * this app does not have.
 */
export type Effect = 'speed' | 'productivity' | 'consumption' | 'pollution' | 'quality';

/**
 * A module, as far as throughput is concerned. Modules are items, so the name, the icon, the stack
 * size and the complexity are all on the `item:<id>` resource already; what is here is only what
 * putting one in a machine does.
 *
 * Both effects are the fraction added per module, and they add up across the slots: a machine with
 * three `speed-module-3` (`speed: 0.4`) in it runs at 1 + 3 × 0.4 = 2.2×. See `moduleEffects` in
 * `src/flow.ts` for the arithmetic, and the two gates on it.
 *
 * The game also lets a module name the recipes it is allowed on (`limitation`), which is how 1.1
 * kept productivity modules on intermediates. 2.0 moved that decision to the recipe, as
 * `Recipe.allowProductivity`, and no module in this pack sets `limitation` at all — so it is not
 * ingested, and a pack which used it would need this comment revisited rather than a new field
 * quietly doing nothing.
 */
export interface Module {
  /** A `module-category` id — `speed`, `productivity`, `angels-bio-yield`. Machines whitelist these. */
  category: string;
  /** The game's own tier number, 1–5 here. Within a category it is the upgrade order. */
  tier: number;
  /** Added to the machine's speed. Negative on productivity modules, which is the trade. */
  speed?: number;
  /** Added to everything the recipe produces, and only where `Recipe.allowProductivity` says so. */
  productivity?: number;
}
