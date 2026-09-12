import type { Recipe, ResourceId, StaticData } from './types.ts';

/**
 * The small, acyclic prefix of the from-air search used by recipe suggestions. The full from-air
 * view also considers productive cycles, but those are deliberately excluded here.
 */
export function fromAirSuggestionStages(
  data: Pick<StaticData, 'recipes'>,
): Array<Array<{ id: string; adds: ResourceId[] }>> {
  const allowed = new Set<ResourceId>();
  const remaining = Object.entries(data.recipes).filter(
    ([id, recipe]) => usableFromAirRecipe(id, recipe) && (recipe.complexity ?? Infinity) <= 1,
  );
  const inputRecipeIds = new Map<ResourceId, Set<string>>();
  for (const [id, recipe] of remaining) {
    for (const { resource } of recipe.ingredients) {
      const ids = inputRecipeIds.get(resource) ?? new Set<string>();
      ids.add(id);
      inputRecipeIds.set(resource, ids);
    }
  }

  const stages: Array<Array<{ id: string; adds: ResourceId[] }>> = [];
  while (stages.length < 2) {
    const stage = remaining
      .filter(([, recipe]) => recipe.ingredients.every(({ resource }) => allowed.has(resource)))
      .map(([id, recipe]) => ({ id, adds: usefulProducts(id, recipe, allowed, inputRecipeIds) }))
      .filter(({ adds }) => adds.length > 0);
    if (stage.length === 0) break;
    stages.push(stage);
    for (const { adds } of stage) for (const resource of adds) allowed.add(resource);
    const used = new Set(stage.map(({ id }) => id));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (used.has(remaining[i]![0])) remaining.splice(i, 1);
    }
  }
  return stages;
}

function usableFromAirRecipe(id: string, recipe: Recipe): boolean {
  return !(recipe.synthetic && id.startsWith('synthetic:mining-'));
}

function usefulProducts(
  id: string,
  recipe: Recipe,
  allowed: Set<ResourceId>,
  inputRecipeIds: Map<ResourceId, Set<string>>,
): ResourceId[] {
  const products = new Set<ResourceId>();
  for (const { resource } of recipe.products) {
    const consumers = inputRecipeIds.get(resource);
    if ([...(consumers ?? [])].some((consumerId) => consumerId !== id) && !allowed.has(resource))
      products.add(resource);
  }
  return [...products];
}
