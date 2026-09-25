import type { ResourceId, StaticData } from '../types.ts';

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
