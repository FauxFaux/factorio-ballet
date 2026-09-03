import type { Beacon, Effect, Machine, Module, ModuleId, Recipe } from '../types.ts';
import { staticData } from './decode.ts';

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
export function modulesFor(machine: Machine, recipe: Recipe): ModuleMatch[] {
  if (!machine.moduleSlots) return [];
  const out: ModuleMatch[] = [];
  for (const [id, module] of Object.entries(staticData.modules)) {
    if (!takesCategory(machine, module.category)) continue;
    const faster = (module.speed ?? 0) > 0 && allowsEffect(machine, 'speed');
    const moreOut =
      (module.productivity ?? 0) > 0 &&
      allowsEffect(machine, 'productivity') &&
      recipe.allowProductivity;
    if (!faster && !moreOut) continue;
    out.push({ id, module, complexity: staticData.resources[`item:${id}`]?.complexity });
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

const KNOWN_CATEGORIES: ModuleCategory[] = [
  { id: 'speed', human: 'speed', effect: 'speed' },
  { id: 'productivity', human: 'productivity', effect: 'productivity' },
  { id: 'angels-bio-yield', human: 'agricultural', effect: 'productivity' },
];

const cheapestModule = (a: ModuleMatch, b: ModuleMatch): number =>
  complexityOf(a) - complexityOf(b) || a.module.tier - b.module.tier || a.id.localeCompare(b.id);

const byModuleCategory = ((): Map<string, ModuleMatch[]> => {
  const index = new Map<string, ModuleMatch[]>();
  for (const [id, module] of Object.entries(staticData.modules)) {
    let list = index.get(module.category);
    if (!list) index.set(module.category, (list = []));
    list.push({ id, module, complexity: staticData.resources[`item:${id}`]?.complexity });
  }
  for (const list of index.values()) list.sort(cheapestModule);
  return index;
})();

export const moduleCategories: ModuleCategory[] = [
  ...KNOWN_CATEGORIES.filter(({ id }) => byModuleCategory.has(id)),
  ...[...byModuleCategory]
    .filter(([id]) => !KNOWN_CATEGORIES.some((known) => known.id === id))
    .map(([id, modules]) => ({
      id,
      human: id,
      effect: modules.some(({ module }) => (module.productivity ?? 0) > 0)
        ? ('productivity' as const)
        : ('speed' as const),
    })),
];

export function modulesIn(category: string): ModuleMatch[] {
  return byModuleCategory.get(category) ?? [];
}

export function categoryEffect(category: string): BoostEffect {
  return moduleCategories.find(({ id }) => id === category)?.effect ?? 'speed';
}

export function headlineEffect(category: ModuleCategory, module: Module): number {
  return module[category.effect] ?? 0;
}

export function defaultModule(modules: ModuleMatch[], progress: number): ModuleMatch | undefined {
  return modules.findLast((match) => complexityOf(match) <= progress);
}

export type ChosenModules = Record<string, ModuleId | undefined>;

export type ModuleChoice = Record<string, ModuleId | null>;

export function chosenModule(
  choice: ModuleChoice,
  category: string,
  progress: number,
): ModuleId | undefined {
  const picked = choice[category];
  if (picked !== undefined) return picked ?? undefined;
  return defaultModule(modulesIn(category), progress)?.id;
}

export function chosenModules(choice: ModuleChoice, progress: number): ChosenModules {
  return Object.fromEntries(
    moduleCategories.map(({ id }) => [id, chosenModule(choice, id, progress)]),
  );
}

const familiesOf = (effect: BoostEffect): ModuleCategory[] =>
  moduleCategories.filter((category) => category.effect === effect);

const worthOf = (id: ModuleId | undefined, effect: BoostEffect): number =>
  (id === undefined ? 0 : (staticData.modules[id]?.[effect] ?? 0)) || 0;

export function moduleFor(
  machine: Machine,
  effect: BoostEffect,
  chosen: ChosenModules,
): ModuleId | undefined {
  const named = familiesOf(effect).filter(({ id }) => chosen[id] !== undefined);
  const takes = named.filter((category) => takesCategory(machine, category.id));
  const pool = takes.length > 0 ? takes : named;
  return pool
    .map(({ id }) => chosen[id])
    .toSorted((a, b) => worthOf(b, effect) - worthOf(a, effect))[0];
}

export function familyFor(machine: Machine | undefined, effect: BoostEffect): string {
  const families = familiesOf(effect);
  const takes = machine
    ? families.filter((category) => takesCategory(machine, category.id))
    : families;
  const best = (category: ModuleCategory) =>
    Math.max(0, ...modulesIn(category.id).map(({ module }) => module[effect] ?? 0));
  return (
    (takes.length > 0 ? takes : families).toSorted((a, b) => best(b) - best(a))[0]?.id ??
    (effect === 'speed' ? 'speed' : 'productivity')
  );
}

export function categoryName(category: string): string {
  return moduleCategories.find(({ id }) => id === category)?.human ?? category;
}

function complexityOf(of: { complexity?: number }): number {
  return of.complexity ?? Infinity;
}
