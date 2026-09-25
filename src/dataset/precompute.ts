import type { Machine, ResourceId, StaticData } from '../types.ts';
import type { MachineMatch } from '../data/machines.ts';
import { isBarrelling, isUnbarrelling, isVoid } from '../compute/recipes.ts';
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
