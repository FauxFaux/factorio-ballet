import type { Beacon, Effect, Machine, Module, ModuleId, Recipe, StaticData } from '../types.ts';
import { type Dataset } from '../dataset';
import { cheapestModule } from '../dataset/precompute.ts';

/** Whether a machine applies one of the module effects. */
export function allowsEffect(machine: Machine, effect: Effect): boolean {
  return machine.allowedEffects?.includes(effect) ?? true;
}

/** Whether a machine or beacon will take a module category; absent means all. */
export function takesCategory(machine: Machine | Beacon, category: string): boolean {
  return machine.allowedModuleCategories?.includes(category) ?? true;
}

export interface ModuleMatch {
  id: ModuleId;
  module: Module;
  complexity?: number;
}

/** The modules which would do something in this machine on this recipe, cheapest first. */
export function modulesFor(data: StaticData, machine: Machine, recipe: Recipe): ModuleMatch[] {
  if (!machine.moduleSlots) return [];
  const out: ModuleMatch[] = [];
  for (const [id, module] of Object.entries(data.modules)) {
    if (!takesCategory(machine, module.category)) continue;
    const faster = (module.speed ?? 0) > 0 && allowsEffect(machine, 'speed');
    const moreOut =
      (module.productivity ?? 0) > 0 &&
      allowsEffect(machine, 'productivity') &&
      recipe.allowProductivity;
    if (!faster && !moreOut) continue;
    out.push({ id, module, complexity: data.resources[`item:${id}`]?.complexity });
  }
  return out.sort(cheapestModule);
}

export interface ModuleCategory {
  id: string;
  human: string;
  effect: BoostEffect;
}

export type BoostEffect = 'speed' | 'productivity';

export const SPEED_CATEGORY = 'speed';
export const PRODUCTIVITY_CATEGORY = 'productivity';
export const BOOST_CATEGORY: Record<BoostEffect, string> = {
  speed: SPEED_CATEGORY,
  productivity: PRODUCTIVITY_CATEGORY,
};

export function modulesIn(ds: Dataset, category: string): readonly ModuleMatch[] {
  return ds.modulesByCategory.get(category) ?? [];
}

export function categoryEffect(ds: Dataset, category: string): BoostEffect {
  return ds.moduleCategories.find(({ id }) => id === category)?.effect ?? 'speed';
}

export function headlineEffect(category: ModuleCategory, module: Module): number {
  return module[category.effect] ?? 0;
}

export function defaultModule(
  modules: readonly ModuleMatch[],
  progress: number,
): ModuleMatch | undefined {
  return modules.findLast((match) => complexityOf(match) <= progress);
}

export type ChosenModules = Record<string, ModuleId | undefined>;

export type ModuleChoice = Record<string, ModuleId | null>;

export function chosenModule(
  ds: Dataset,
  choice: ModuleChoice,
  category: string,
  progress: number,
): ModuleId | undefined {
  const picked = choice[category];
  if (picked !== undefined) return picked ?? undefined;
  return defaultModule(modulesIn(ds, category), progress)?.id;
}

export function chosenModules(ds: Dataset, choice: ModuleChoice, progress: number): ChosenModules {
  return Object.fromEntries(
    ds.moduleCategories.map(({ id }) => [id, chosenModule(ds, choice, id, progress)]),
  );
}

const familiesOf = (ds: Dataset, effect: BoostEffect): ModuleCategory[] =>
  ds.moduleCategories.filter((category) => category.effect === effect);

const worthOf = (data: StaticData, id: ModuleId | undefined, effect: BoostEffect): number =>
  (id === undefined ? 0 : (data.modules[id]?.[effect] ?? 0)) || 0;

export function moduleFor(
  ds: Dataset,
  machine: Machine,
  effect: BoostEffect,
  chosen: ChosenModules,
): ModuleId | undefined {
  const named = familiesOf(ds, effect).filter(({ id }) => chosen[id] !== undefined);
  const takes = named.filter((category) => takesCategory(machine, category.id));
  /* Productivity only works from the machine's own slots, so a category the machine refuses is
     not a usable fallback. Speed can still be named for a machine which will not hold it itself:
     beacons may take that category and transmit its speed effect. */
  const pool = takes.length > 0 ? takes : effect === 'productivity' ? [] : named;
  return pool
    .map(({ id }) => chosen[id])
    .toSorted((a, b) => worthOf(ds.data, b, effect) - worthOf(ds.data, a, effect))[0];
}

export function familyFor(machine: Machine | undefined, effect: BoostEffect, ds: Dataset): string {
  const families = familiesOf(ds, effect);
  const takes = machine
    ? families.filter((category) => takesCategory(machine, category.id))
    : families;
  const best = (category: ModuleCategory) =>
    Math.max(0, ...modulesIn(ds, category.id).map(({ module }) => module[effect] ?? 0));
  return (
    (takes.length > 0 ? takes : families).toSorted((a, b) => best(b) - best(a))[0]?.id ??
    (effect === 'speed' ? 'speed' : 'productivity')
  );
}

export function categoryName(ds: Dataset, category: string): string {
  return ds.moduleCategories.find(({ id }) => id === category)?.human ?? category;
}

function complexityOf(of: { complexity?: number }): number {
  return of.complexity ?? Infinity;
}
