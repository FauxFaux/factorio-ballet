import type { Machine, ResourceId, StaticData } from '../types.ts';
import type { MachineMatch } from '../data/machines.ts';
import type { ModuleCategory, ModuleMatch } from '../data/modules.ts';
import type { BeaconMatch, BeltMatch } from '../data/index.ts';
import { isBarrelling, isUnbarrelling, isVoid } from '../compute/recipes.ts';
import { selectPackLandmarks, type Landmark } from '../compute/landmarks.ts';
import { resourceChainFinder } from '../compute/void-path.ts';

function machineComplexity(data: StaticData, machine: Machine): number | undefined {
  if (machine.item === undefined) return machine.kind === 'character' ? 0 : undefined;
  return data.resources[`item:${machine.item}`]?.complexity;
}

/** Machines indexed by the categories they can craft for one dataset. */
export function buildMachinesByCategory(
  data: StaticData,
): ReadonlyMap<string, readonly MachineMatch[]> {
  const index = new Map<string, MachineMatch[]>();
  for (const [id, machine] of Object.entries(data.machines)) {
    for (const category of machine.categories) {
      let list = index.get(category);
      if (!list) index.set(category, (list = []));
      list.push({ id, machine, complexity: machineComplexity(data, machine) });
    }
  }
  return index;
}

const KNOWN_MODULE_CATEGORIES: ModuleCategory[] = [
  { id: 'speed', human: 'speed', effect: 'speed' },
  { id: 'productivity', human: 'productivity', effect: 'productivity' },
  { id: 'angels-bio-yield', human: 'agricultural', effect: 'productivity' },
];

const complexityOf = (match: { complexity?: number }): number => match.complexity ?? Infinity;

export const cheapestModule = (a: ModuleMatch, b: ModuleMatch): number =>
  complexityOf(a) - complexityOf(b) || a.module.tier - b.module.tier || a.id.localeCompare(b.id);

export interface ModuleIndex {
  byCategory: ReadonlyMap<string, readonly ModuleMatch[]>;
  categories: readonly ModuleCategory[];
}

/** Build the sorted module families and their display categories for one dataset. */
export function buildModuleIndex(data: StaticData): ModuleIndex {
  const byCategory = new Map<string, ModuleMatch[]>();
  for (const [id, module] of Object.entries(data.modules)) {
    let list = byCategory.get(module.category);
    if (!list) byCategory.set(module.category, (list = []));
    list.push({ id, module, complexity: data.resources[`item:${id}`]?.complexity });
  }
  for (const list of byCategory.values()) list.sort(cheapestModule);
  return {
    byCategory,
    categories: [
      ...KNOWN_MODULE_CATEGORIES.filter(({ id }) => byCategory.has(id)),
      ...[...byCategory]
        .filter(([id]) => !KNOWN_MODULE_CATEGORIES.some((known) => known.id === id))
        .map(([id, modules]) => ({
          id,
          human: id,
          effect: modules.some(({ module }) => (module.productivity ?? 0) > 0)
            ? ('productivity' as const)
            : ('speed' as const),
        })),
    ],
  };
}

/** Science packs kept far enough apart to label the progress slider. */
export function buildPackLandmarks(data: StaticData): readonly Landmark[] {
  return selectPackLandmarks(data.sciencePacks, data.resources);
}

/** Beacon tiers ordered by unlock complexity, slots, and id. */
export function buildBeaconTiers(data: StaticData): readonly BeaconMatch[] {
  return Object.entries(data.beacons ?? {})
    .map(([id, beacon]) => ({
      id,
      beacon,
      complexity: data.resources[`item:${beacon.item ?? id}`]?.complexity,
    }))
    .sort(
      (a, b) =>
        complexityOf(a) - complexityOf(b) ||
        a.beacon.moduleSlots - b.beacon.moduleSlots ||
        a.id.localeCompare(b.id),
    );
}

/** Belt tiers ordered by unlock complexity, throughput, and id. */
export function buildBeltTiers(data: StaticData): readonly BeltMatch[] {
  return Object.entries(data.belts)
    .map(([id, belt]) => ({
      id,
      belt,
      complexity: data.resources[`item:${belt.item ?? id}`]?.complexity,
    }))
    .sort(
      (a, b) =>
        complexityOf(a) - complexityOf(b) ||
        a.belt.itemsPerSecond - b.belt.itemsPerSecond ||
        a.id.localeCompare(b.id),
    );
}

export interface SuggestionPlanIndex {
  resourceChains: ReturnType<typeof resourceChainFinder>;
  producers: ReadonlyMap<ResourceId, readonly string[]>;
  consumers: ReadonlyMap<ResourceId, readonly string[]>;
  soleProducer: ReadonlyMap<ResourceId, string>;
  soleConsumer: ReadonlyMap<ResourceId, string>;
  freeRecipeByProduct: ReadonlyMap<ResourceId, string>;
}

/** Build recipe indexes used by recipe suggestions for one dataset. */
export function buildSuggestionPlanIndex(data: StaticData): SuggestionPlanIndex {
  const indexRecipes = (direction: 'ingredients' | 'products') => {
    const recipes = new Map<ResourceId, string[]>();
    for (const [id, recipe] of Object.entries(data.recipes)) {
      if (isVoid(recipe) || isBarrelling(recipe) || isUnbarrelling(recipe)) continue;
      for (const resource of new Set(recipe[direction].map(({ resource }) => resource))) {
        const indexed = recipes.get(resource);
        if (indexed) indexed.push(id);
        else recipes.set(resource, [id]);
      }
    }
    return recipes;
  };
  const uniqueRecipes = (recipesByResource: ReadonlyMap<ResourceId, readonly string[]>) =>
    new Map(
      [...recipesByResource].flatMap(([resource, recipes]) =>
        recipes.length === 1 ? [[resource, recipes[0]!]] : [],
      ),
    );
  const producers = indexRecipes('products');
  const consumers = indexRecipes('ingredients');
  return {
    resourceChains: resourceChainFinder(data),
    producers,
    consumers,
    soleProducer: uniqueRecipes(producers),
    soleConsumer: uniqueRecipes(consumers),
    freeRecipeByProduct: new Map(
      Object.entries(data.suggestionPreload.fromAirRecipeByProduct) as [ResourceId, string][],
    ),
  };
}

/** Find resources produced by exactly one recipe in this dataset. */
export function buildSoleProducerIndex(data: StaticData): ReadonlyMap<ResourceId, string> {
  const producers = new Map<ResourceId, string>();
  const ambiguous = new Set<ResourceId>();
  for (const [recipeId, recipe] of Object.entries(data.recipes)) {
    for (const resource of new Set(recipe.products.map((product) => product.resource))) {
      if (ambiguous.has(resource)) continue;
      if (producers.has(resource)) {
        producers.delete(resource);
        ambiguous.add(resource);
      } else {
        producers.set(resource, recipeId);
      }
    }
  }
  return producers;
}
