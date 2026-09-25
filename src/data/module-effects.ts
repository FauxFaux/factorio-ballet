import {
  allowsEffect,
  BOOST_CATEGORY,
  categoryEffect,
  familyFor,
  moduleFor,
  takesCategory,
  type BoostEffect,
  type ChosenModules,
} from './modules.ts';
import type { Beacon, Machine, ModuleId, Recipe, StaticData } from '../types.ts';
import { type Dataset } from '../dataset';

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

function slotEffects(data: StaticData, machine: Machine, fill: ModuleFill): Slots {
  let speed = 0;
  let productivity = 0;
  let free = machine.moduleSlots ?? 0;
  for (const [id, count] of Object.entries(fill)) {
    if (free <= 0) break;
    const module = data.modules[id];
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

export function moduleEffects(
  data: StaticData,
  machine: Machine,
  fill: ModuleFill,
  recipe: Recipe,
): Effects {
  return applyBoost(machine, recipe, slotEffects(data, machine, fill));
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
  ds: Dataset,
  machine: Machine,
  free: number,
  module: ModuleId | undefined,
  wanted: number | undefined,
  beacon: Beacon | undefined,
  wantedBeacons = 0,
): Boost {
  const found = module === undefined ? undefined : ds.data.modules[module];
  if (!module || !found || !machine.moduleSlots) return NO_BOOST;
  const effect = categoryEffect(ds, found.category);
  const slots = takesCategory(machine, found.category) ? Math.max(0, free) : 0;
  const asked = wanted ?? slots;
  const inMachine = Math.min(asked, slots);
  const holds =
    beacon &&
    beacon.moduleSlots > 0 &&
    takesCategory(beacon, found.category) &&
    (beacon.allowedEffects?.includes(effect) ?? true)
      ? beacon.moduleSlots
      : 0;
  const beacons = holds ? wantedBeacons : 0;
  const inBeacons = holds ? beacons * holds : 0;
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
  beacons?: number;
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
  ds: Dataset,
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
    ds,
    machine,
    slots,
    moduleFor(ds, machine, 'productivity', modules),
    Math.min(wants.productivity ?? auto, slots),
    beacon,
  );
  const speed = moduleBoost(
    ds,
    machine,
    slots - productivity.inMachine,
    moduleFor(ds, machine, 'speed', modules),
    wants.speed,
    beacon,
    wants.beacons,
  );
  return {
    productivity,
    speed,
    slots,
    reaches,
    families: {
      productivity: familyFor(machine, 'productivity', ds),
      speed: familyFor(machine, 'speed', ds),
    },
  };
}

export function laidOutEffects(
  ds: Dataset,
  machine: Machine,
  fill: ModuleFill | undefined,
  recipe: Recipe,
  modules: ChosenModules,
  wants: ModuleWants,
  beacon: Beacon | undefined,
): { effects: Effects; layout: Layout } {
  const slots = slotEffects(ds.data, machine, fill ?? {});
  const layout = moduleLayout(ds, machine, slots.free, recipe, modules, wants, beacon);
  return {
    effects: applyBoost(machine, recipe, slots, layout.productivity, layout.speed),
    layout,
  };
}
