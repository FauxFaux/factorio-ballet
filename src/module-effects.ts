import {
  allowsEffect,
  BOOST_CATEGORY,
  categoryEffect,
  familyFor,
  moduleFor,
  staticData,
  takesCategory,
  type BoostEffect,
  type ChosenModules,
} from './data/index.ts';
import type { Beacon, Machine, ModuleId, Recipe } from './types.ts';

export interface Effects {
  speed: number;
  productivity: number;
}

export const NO_EFFECTS: Effects = { speed: 1, productivity: 1 };

const MIN_SPEED = 0.2;

export type ModuleFill = Record<ModuleId, number>;

export function fillSlots(machine: Machine, module: ModuleId): ModuleFill {
  return machine.moduleSlots ? { [module]: machine.moduleSlots } : {};
}

interface Slots {
  speed: number;
  productivity: number;
  free: number;
}

function slotEffects(machine: Machine, fill: ModuleFill): Slots {
  let speed = 0;
  let productivity = 0;
  let free = machine.moduleSlots ?? 0;
  for (const [id, count] of Object.entries(fill)) {
    if (free <= 0) break;
    const module = staticData.modules[id];
    if (!module || !(count > 0)) continue;
    if (!takesCategory(machine, module.category)) continue;
    const fitted = Math.min(count, free);
    free -= fitted;
    speed += (module.speed ?? 0) * fitted;
    productivity += (module.productivity ?? 0) * fitted;
  }
  return { speed, productivity, free };
}

function applyBoost(machine: Machine, recipe: Recipe, slots: Slots, ...boosts: Boost[]): Effects {
  let speed = slots.speed + boosts.reduce((total, boost) => total + boost.speed, 0);
  let productivity =
    slots.productivity + boosts.reduce((total, boost) => total + boost.productivity, 0);
  if (!allowsEffect(machine, 'speed')) speed = 0;
  if (!allowsEffect(machine, 'productivity') || !recipe.allowProductivity) productivity = 0;
  return { speed: Math.max(MIN_SPEED, 1 + speed), productivity: 1 + productivity };
}

export function moduleEffects(machine: Machine, fill: ModuleFill, recipe: Recipe): Effects {
  return applyBoost(machine, recipe, slotEffects(machine, fill));
}

export interface Boost {
  module?: ModuleId;
  wanted: number;
  inMachine: number;
  inBeacons: number;
  beacons: number;
  transmission: number;
  speed: number;
  productivity: number;
}

export const NO_BOOST: Boost = {
  wanted: 0,
  inMachine: 0,
  inBeacons: 0,
  beacons: 0,
  transmission: 0,
  speed: 0,
  productivity: 0,
};

export function moduleBoost(
  machine: Machine,
  free: number,
  module: ModuleId | undefined,
  wanted: number | undefined,
  beacon: Beacon | undefined,
): Boost {
  const found = module === undefined ? undefined : staticData.modules[module];
  if (!module || !found || !machine.moduleSlots) return NO_BOOST;
  const effect = categoryEffect(found.category);
  const slots = takesCategory(machine, found.category) ? Math.max(0, free) : 0;
  const asked = wanted ?? slots;
  const inMachine = Math.min(asked, slots);
  const spare = asked - inMachine;
  const holds =
    beacon &&
    beacon.moduleSlots > 0 &&
    takesCategory(beacon, found.category) &&
    (beacon.allowedEffects?.includes(effect) ?? true)
      ? beacon.moduleSlots
      : 0;
  const inBeacons = holds ? spare : 0;
  const beacons = holds ? Math.ceil(inBeacons / holds) : 0;
  const transmission = beacons ? (beacon?.distributionEffectivity ?? 0) / Math.sqrt(beacons) : 0;
  const felt = inMachine + inBeacons * transmission;
  return {
    module,
    wanted: asked,
    inMachine,
    inBeacons,
    beacons,
    transmission,
    speed: felt * (found.speed ?? 0),
    productivity: felt * (found.productivity ?? 0),
  };
}

export interface ModuleWants {
  productivity?: number;
  speed?: number;
}

export interface Layout {
  productivity: Boost;
  speed: Boost;
  slots: number;
  families: Record<BoostEffect, string>;
  reaches: Record<BoostEffect, boolean>;
}

export const NO_LAYOUT: Layout = {
  productivity: NO_BOOST,
  speed: NO_BOOST,
  slots: 0,
  families: BOOST_CATEGORY,
  reaches: { productivity: false, speed: false },
};

export function moduleLayout(
  machine: Machine,
  free: number,
  recipe: Recipe,
  modules: ChosenModules,
  wants: ModuleWants,
  beacon: Beacon | undefined,
): Layout {
  const slots = Math.max(0, free);
  const reaches = {
    speed: !!machine.moduleSlots && allowsEffect(machine, 'speed'),
    productivity:
      !!machine.moduleSlots && allowsEffect(machine, 'productivity') && !!recipe.allowProductivity,
  };
  const auto = reaches.productivity ? slots : 0;
  const productivity = moduleBoost(
    machine,
    slots,
    moduleFor(machine, 'productivity', modules),
    Math.min(wants.productivity ?? auto, slots),
    beacon,
  );
  const speed = moduleBoost(
    machine,
    slots - productivity.inMachine,
    moduleFor(machine, 'speed', modules),
    wants.speed,
    beacon,
  );
  return {
    productivity,
    speed,
    slots,
    reaches,
    families: {
      productivity: familyFor(machine, 'productivity'),
      speed: familyFor(machine, 'speed'),
    },
  };
}

export function laidOutEffects(
  machine: Machine,
  fill: ModuleFill | undefined,
  recipe: Recipe,
  modules: ChosenModules,
  wants: ModuleWants,
  beacon: Beacon | undefined,
): { effects: Effects; layout: Layout } {
  const slots = slotEffects(machine, fill ?? {});
  const layout = moduleLayout(machine, slots.free, recipe, modules, wants, beacon);
  return {
    effects: applyBoost(machine, recipe, slots, layout.productivity, layout.speed),
    layout,
  };
}
