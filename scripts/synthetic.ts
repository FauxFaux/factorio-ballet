/**
 * The sources of a resource which are not recipes.
 *
 * Some of what the game makes has no `data.raw.recipe` behind it at all: an offshore pump conjures
 * fluid out of the tile it stands on, a mining drill pulls ore out of a patch, and a reactor turns
 * a fuel cell into its spent result. All are conversions with a machine, a duration and a rate —
 * everything a recipe has — so this builds them into recipe-shaped records the rest of the
 * pipeline can treat like any other.
 *
 * They are deliberately marked, not disguised: the ids are `synthetic:pumping-water`,
 * `synthetic:mining-coal` and `synthetic:burning-uranium-fuel-cell`, and the ingest sets
 * `Recipe.synthetic` so the UI can say so.
 *
 * Two consumers, which is why this is its own module. `scripts/complexity.ts` needs them to reach
 * large parts of the graph at all (water, and Angel's whole mud line), and splits each one back out
 * per machine; `scripts/ingest-data.ts` emits them into `static.json` along with the machines.
 *
 * Rocket launches are still missing, and named in `scripts/complexity.ts` instead.
 */

import type { BoundingBox, RawData } from 'factorio-raw-types/prototypes';
import { ITEM_KEYS } from './raw-keys.ts';
import { arr, effectLimits, RProduct, type RIngredient } from './raw-validators.ts';
import { entriesOf } from '../src/ts.ts';
import type { Effect, MachineKind, MachineSize } from '../src/types.ts';

/** Factorio runs at 60 ticks/s; pump speed and joule-spelled power both need that conversion. */
const TICKS = 60;

/**
 * `minable.fluid_amount` is stated ten times too large — the prototype value must be divisible by
 * ten and the game divides it out again before showing or consuming it, so the `10` on every
 * infinite ore here is one acid per ore, not ten.
 */
const FLUID_AMOUNT_SCALE = 10;

/** The game's default for a `resource` naming no category. */
const DEFAULT_RESOURCE_CATEGORY = 'basic-solid';

/** A machine which runs a synthetic recipe: a mining drill, an offshore pump or a reactor. */
export interface SyntheticMachine {
  /** Entity prototype id, which is how `Machine` is keyed. */
  id: string;
  /** The item which places it. What having this machine actually costs. */
  item: string;
  kind: MachineKind;
  /** Crafts per second of a one-second recipe, as `Machine.speed`. */
  speed: number;
  size: MachineSize;
  moduleSlots?: number;
  /** As `Machine.allowedEffects` / `Machine.allowedModuleCategories`: absent means no restriction. */
  allowedEffects?: Effect[];
  allowedModuleCategories?: string[];
}

export interface SyntheticRecipe {
  /** For example `synthetic:pumping-water` or `synthetic:burning-uranium-fuel-cell`. */
  id: string;
  /**
   * An invented recipe category, the one entry of these machines' `Machine.categories`. Namespaced
   * so it cannot collide with a real one: the game has a `water` resource category and could just
   * as well have a `water` recipe category.
   */
  category: string;
  /** How to name it: `<verb> <the game's name for `source` in the `locale` namespace>`. */
  name: { verb: string; locale: 'item' | 'fluid' | 'entity'; source: string };
  duration: number;
  /** Raw-shaped, so each consumer can reuse the conversion it already has. */
  ingredients: RIngredient[];
  products: RProduct[];
  /** Every machine which can run it. A recipe with no machine is never emitted. */
  machines: SyntheticMachine[];
}

/** Entity prototype id -> the item which places it. First item wins; nothing needs more. */
export function placingItems(raw: RawData): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of ITEM_KEYS) {
    for (const [id, item] of entriesOf(raw[key] ?? {})) {
      if (item.place_result && !out.has(item.place_result)) out.set(item.place_result, id);
    }
  }
  return out;
}

export function syntheticRecipes(raw: RawData): SyntheticRecipe[] {
  const placedBy = placingItems(raw);
  return [...pumping(raw, placedBy), ...mining(raw, placedBy), ...burningFuelCells(raw, placedBy)];
}

/**
 * Offshore pumps, one recipe per fluid they can produce.
 *
 * This is where water comes from, and — the reason it matters beyond water — Angel's seafloor pump
 * is the only entry point to the mud line, whose recipes otherwise all consume mud.
 *
 * `pumping_speed` is fluid per tick and `Machine.speed` is the multiplier on a one-second recipe,
 * so quoting the recipe as "one second, 60 fluid" makes the two line up exactly: the vanilla pump's
 * speed of 20 reads as 1200 water/s, which is what it does.
 */
function* pumping(raw: RawData, placedBy: Map<string, string>): Generator<SyntheticRecipe> {
  const byFluid = new Map<string, SyntheticMachine[]>();
  for (const [id, pump] of Object.entries(raw['offshore-pump'] ?? {})) {
    const item = placedBy.get(id);
    // No placing item means a building half you never handle yourself — Angel's heavy offshore pump
    // is an `offshore-pump` you place and a `mining-drill` it swaps itself for, and only the first
    // has an item. Taking both would double every rate it produces.
    if (pump.hidden || !item) continue;
    // The vanilla pump names no filter and means water.
    const fluid = pump.fluid_box.filter ?? 'water';
    push(byFluid, fluid, {
      id,
      item,
      kind: 'offshore-pump',
      speed: pump.pumping_speed,
      size: machineSize(pump.collision_box, id),
    });
  }

  for (const [fluid, machines] of byFluid) {
    yield {
      id: `synthetic:pumping-${fluid}`,
      category: `synthetic-pump:${fluid}`,
      name: { verb: 'Pumping', locale: 'fluid', source: fluid },
      duration: 1,
      ingredients: [],
      products: [{ type: 'fluid', name: fluid, amount: TICKS }],
      machines,
    };
  }
}

/**
 * Mining drills, one recipe per resource patch they can work.
 *
 * The game already has a category system here — a drill's `resource_categories` against a
 * resource's `category` — so this only has to namespace it. `mining_speed` is crafts per second of
 * a `mining_time`-second recipe, which is our machine/duration model unchanged.
 *
 * Not modelled: patch richness. A pumpjack's real output scales with the well's yield percentage,
 * so the oil rates here are the 100% ones.
 */
function* mining(raw: RawData, placedBy: Map<string, string>): Generator<SyntheticRecipe> {
  const byCategory = new Map<string, SyntheticMachine[]>();
  for (const [id, drill] of Object.entries(raw['mining-drill'] ?? {})) {
    const item = placedBy.get(id);
    if (drill.hidden || !item) continue;
    for (const category of drill.resource_categories) {
      push(byCategory, category, {
        id,
        item,
        kind: 'mining-drill',
        speed: drill.mining_speed,
        size: machineSize(drill.collision_box, id),
        moduleSlots: drill.module_slots,
        allowedEffects: effectLimits(drill.allowed_effects),
        allowedModuleCategories: drill.allowed_module_categories,
      });
    }
  }

  for (const [id, resource] of Object.entries(raw.resource ?? {})) {
    // Only what the map generator places. An unplaced resource is a mod's own scaffolding —
    // `angels-sea-pump-resource` is the far half of the building whose near half is the offshore
    // pump above, and would otherwise emit that pump's water a second time.
    if (resource.hidden || !resource.autoplace || !resource.minable) continue;
    const minable = resource.minable;
    const machines = byCategory.get(resource.category ?? DEFAULT_RESOURCE_CATEGORY);
    if (!machines?.length) continue;

    const products = arr(minable.results ?? []).map((p) => RProduct.parse(p));
    // `result`/`count` is the old one-product spelling; coal still uses it.
    if (minable.result) {
      products.push({ type: 'item', name: minable.result, amount: minable.count ?? 1 });
    }
    if (!products.length) continue;

    yield {
      id: `synthetic:mining-${id}`,
      category: `synthetic-mine:${resource.category ?? DEFAULT_RESOURCE_CATEGORY}`,
      name: { verb: 'Mining', locale: 'entity', source: id },
      duration: minable.mining_time,
      ingredients: minable.required_fluid
        ? [
            {
              type: 'fluid',
              name: minable.required_fluid,
              amount: (minable.fluid_amount ?? 0) / FLUID_AMOUNT_SCALE,
            },
          ]
        : [],
      products,
      machines,
    };
  }
}

/**
 * Reactor fuel cells, one recipe per live item with a spent-cell result.
 *
 * A reactor consumes energy rather than performing crafts, but its fuel-cell rate has the same
 * separable shape as our recipe/machine model:
 *
 *     cells / second = reactor consumption (MW) / cell fuel value (MJ)
 *
 * Quoting the recipe duration as the fuel value in MJ and the machine speed as its consumption in
 * MW therefore makes `speed / duration` the exact burn rate, and lets one recipe run in every
 * reactor accepting its fuel category. `energy_source.effectivity` changes how much of that input
 * becomes heat; it does not change how quickly the input fuel is consumed. Neighbour bonus changes
 * heat output too, so neither belongs in this material-flow-only model.
 *
 * Chemical fuels without `burnt_result` and fluid-burning reactors are deliberately not folded in:
 * they are useful heat inputs, but not the item-to-spent-item conversion represented here.
 */
function* burningFuelCells(
  raw: RawData,
  placedBy: Map<string, string>,
): Generator<SyntheticRecipe> {
  const byFuelCategory = new Map<string, SyntheticMachine[]>();
  for (const [id, reactor] of Object.entries(raw.reactor ?? {})) {
    const item = placedBy.get(id);
    if (reactor.hidden || !item || reactor.energy_source.type !== 'burner') continue;
    for (const category of reactor.energy_source.fuel_categories ?? ['chemical']) {
      push(byFuelCategory, category, {
        id,
        item,
        kind: 'reactor',
        speed: powerInMegawatts(reactor.consumption),
        size: machineSize(reactor.collision_box, id),
      });
    }
  }

  for (const key of ITEM_KEYS) {
    for (const [id, fuel] of entriesOf(raw[key] ?? {})) {
      if (fuel.hidden || fuel.parameter || !fuel.burnt_result || !fuel.fuel_value) continue;
      const fuelCategory = fuel.fuel_category ?? 'chemical';
      const machines = byFuelCategory.get(fuelCategory);
      if (!machines?.length) continue;

      yield {
        id: `synthetic:burning-${id}`,
        category: `synthetic-reactor:${fuelCategory}`,
        name: { verb: 'Burning', locale: 'item', source: id },
        duration: energyInMegajoules(fuel.fuel_value),
        ingredients: [{ type: 'item', name: id, amount: 1 }],
        products: [{ type: 'item', name: fuel.burnt_result, amount: 1 }],
        machines,
      };
    }
  }
}

/** Parse an energy amount in Factorio's string format and return MJ. */
export function energyInMegajoules(value: string): number {
  const { megas, unit } = parseEnergy(value);
  // Factorio treats watts as joules per second and stores them as joules per 60-tick second.
  return unit === 'J' ? megas : megas / TICKS;
}

/** Parse a power in Factorio's string format and return MW. */
export function powerInMegawatts(value: string): number {
  const { megas, unit } = parseEnergy(value);
  // Conversely, a joule spelling on a power field means that many joules each tick.
  return unit === 'W' ? megas : megas * TICKS;
}

function parseEnergy(value: string): { megas: number; unit: 'J' | 'W' } {
  const match = /^(\d+(?:\.\d+)?)([kMGTPEZYRQ]?)([JW])$/.exec(value);
  if (!match) throw new Error(`Unsupported Factorio energy value: ${value}`);
  const amount = Number(match[1]);
  const exponent = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'].indexOf(match[2]);
  if (exponent < 0) throw new Error(`Unsupported Factorio energy multiplier: ${value}`);
  return { megas: amount * 1e3 ** (exponent - 2), unit: match[3] as 'J' | 'W' };
}

/** As in the main ingest: collision boxes are slightly inset from the grid footprint. */
function machineSize(collisionBox: BoundingBox | undefined, id: string): MachineSize {
  if (!collisionBox || !Array.isArray(collisionBox)) {
    throw new Error(`Machine ${id} has no array collision_box`);
  }
  const [left, top] = point(collisionBox[0]);
  const [right, bottom] = point(collisionBox[1]);
  return { width: Math.ceil(right - left), height: Math.ceil(bottom - top) };
}

function point(position: unknown): [number, number] {
  if (!Array.isArray(position) || position.length !== 2) {
    throw new Error('Expected a collision box point to be an array');
  }
  const [x, y] = position;
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('Expected numeric collision box coordinates');
  }
  return [x, y];
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
