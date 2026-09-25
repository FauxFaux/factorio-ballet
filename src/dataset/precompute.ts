import type { ResourceId, StaticData } from '../types.ts';
import { isBarrelling, isUnbarrelling, isVoid } from '../compute/recipes.ts';
import { resourceChainFinder } from '../compute/void-path.ts';

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
