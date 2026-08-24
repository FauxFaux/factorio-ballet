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
   * The beacons: the other place a speed module can go. Keyed by bare prototype id, as machines
   * are — a beacon is not a `Machine` because it runs no recipes, and the only thing this app
   * wants from it is how many modules it holds and how much of them the machine next door gets.
   */
  beacons: Record<BeaconId, Beacon>;

  /**
   * The transport belts, keyed by bare prototype id, with how much they carry. A belt runs no
   * recipes and holds no modules — it is the constraint on getting what a cell makes to wherever
   * it goes next, which is the number a plan is checked against rather than one it computes.
   */
  belts: Record<BeltId, Belt>;

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

/** A beacon's prototype id, e.g. `bob-beacon-2`. */
export type BeaconId = string;

/** A transport belt's prototype id, e.g. `fast-transport-belt`. */
export type BeltId = string;

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

  /**
   * How much of this, per craft, a productivity bonus is *not* paid on — the game's
   * `ignored_by_productivity`, and the whole of the catalyst rule as the data states it. A catalyst
   * is something a recipe borrows rather than makes: the 40 of the 41 uranium-235 kovarex hands
   * back, the milling drum a powderiser returns. Paying a bonus on it would mint matter out of a
   * loop, so the game pays only on `amount - ignoredByProductivity`; {@link netRates} does the
   * same.
   *
   * Ingested rather than derived from "the share which is both in and out", because half of the
   * ones here are not: 109 of the 208 results carrying it name a resource the recipe does not take
   * at all — the drum goes in lubricated and comes out dry, the catalyst carrier goes in red. Nor
   * is it bounded by either amount: `angels-fish-keeping-3` returns one fish of the four it takes
   * and ignores three, so the bonus is paid on nothing.
   *
   * That the field is stated wherever it matters is *checked*, not assumed: `checkCatalysts` in the
   * ingest and `the ingested catalyst shares` in `test/flow.test.ts` both require a product which
   * is also an ingredient of a recipe allowing productivity to state `min(in, out)`. The 1.1 game
   * did not work this way — its `catalyst_amount` was derived by the engine, and kovarex states
   * none in the 1.1 dump despite paying no productivity on the 40 it hands back — so this is a
   * convention of 2.0's recipes rather than a promise of the format. If the check ever fires, the
   * share wants deriving in the ingest.
   *
   * Absent means productivity is paid on all of it.
   */
  ignoredByProductivity?: number;
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

/**
 * A beacon: module slots which do nothing to the beacon and everything to the machines around it.
 * It runs no recipes, so it is not a {@link Machine}; what it is instead is a way of getting more
 * modules onto a machine than the machine has slots for, at a discount which gets worse the more
 * beacons you build.
 *
 * The discount is {@link distributionEffectivity} divided by the square root of how many beacons
 * reach the machine, applied to each module in each of them — so `n` beacons holding the same
 * modules come to `dist × sqrt(n)` times one beacon's worth, and the second beacon is worth 41% of
 * the first. See `moduleBoost` in `src/flow.ts`, and `docs/beacons.wiki`.
 *
 * What is not modelled is where anything is: a beacon reaches a 9×9 square in the game, and this
 * app has no floor plan, so "how many beacons reach this machine" is a number the user states
 * rather than one that follows from a layout.
 */
export interface Beacon {
  human?: string;
  /** The item which places it; bare prototype id, as `Machine.item` is. */
  item?: string;
  moduleSlots: number;
  /**
   * The share of a module's effect this beacon transmits before the count penalty: 1.5 for every
   * beacon in this pack, and the reason one beacon beats a slot in the machine.
   */
  distributionEffectivity: number;
  /**
   * As `Machine.allowedEffects`, and absent means all of them. Every beacon here allows `speed`,
   * `consumption` and `pollution` — which is the game's rule that productivity modules do not go
   * in a beacon, stated as data rather than assumed by the app.
   */
  allowedEffects?: Effect[];
  /** As `Machine.allowedModuleCategories`: refuses the module outright, and absent means all. */
  allowedModuleCategories?: string[];
}

/**
 * A transport belt: a throughput ceiling with a name. Keyed by bare prototype id, which is also the
 * id of the item you place it from — so the name, the icon, the stack size and the complexity are
 * on the `item:<id>` resource already, exactly as they are for a {@link Module}.
 *
 * Only the belt itself is ingested. Its underground and its splitter carry their own copy of the
 * same `speed` in the game data, and in this pack every one of them agrees with the belt it belongs
 * to — `checkBelts` in the ingest says so — so a tier is one number rather than four.
 */
export interface Belt {
  human?: string;
  /** The item which places it; bare prototype id, as `Machine.item` is. */
  item?: string;
  /**
   * What a fully compressed belt carries, in items per second, both lanes together: 15 for the
   * vanilla yellow belt, 60 for bob's turbo.
   *
   * The game states `speed` in tiles per tick instead. Items sit a quarter of a tile apart along a
   * lane, and a belt has two lanes, so the conversion is `speed × 60 × 4 × 2` — see `BELT_LANES`
   * and friends in `scripts/ingest-data.ts`. Fluid does not travel this way and a barrel is an
   * item like any other, so this is the only rate a belt has.
   */
  itemsPerSecond: number;
}
