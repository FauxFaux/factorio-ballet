import { isVoid } from './data/recipes.ts';
import type { Recipe, ResourceId, StaticData } from './types.ts';

export interface VoidPlan {
  recipes: string[];
}

interface SearchState extends VoidPlan {
  dispose: ResourceId[];
  supply: ResourceId[];
}

interface RecipeIndex {
  consumers: Map<ResourceId, string[]>;
  producers: Map<ResourceId, string[]>;
}

const MAX_STEPS = 9;
const MAX_RESULTS = 8;
const MAX_VISITED = 50_000;
const unique = <T>(values: T[]): T[] => [...new Set(values)];

function terminal(recipe: Recipe): boolean {
  return recipe.products.length === 0 || isVoid(recipe);
}

function stateKey({ dispose, supply }: SearchState): string {
  return `${[...dispose].sort().join(',')}|${[...supply].sort().join(',')}`;
}

function indexRecipes(recipes: Record<string, Recipe>): RecipeIndex {
  const consumers = new Map<ResourceId, string[]>();
  const producers = new Map<ResourceId, string[]>();

  for (const [id, recipe] of Object.entries(recipes)) {
    for (const { resource } of recipe.ingredients) {
      const ids = consumers.get(resource);
      if (ids) ids.push(id);
      else consumers.set(resource, [id]);
    }
    for (const { resource } of recipe.products) {
      const ids = producers.get(resource);
      if (ids) ids.push(id);
      else producers.set(resource, [id]);
    }
  }

  return { consumers, producers };
}

/** Put source recipes before the transformations which need them. */
function executionOrder(ids: string[], initial: ResourceId, data: Pick<StaticData, 'recipes'>) {
  const available = new Set<ResourceId>([initial]);
  const remaining = [...ids];
  const ordered: string[] = [];
  while (remaining.length) {
    const index = remaining.findIndex((id) =>
      data.recipes[id].ingredients.every(({ resource }) => available.has(resource)),
    );
    if (index < 0) return ids;
    const [id] = remaining.splice(index, 1);
    ordered.push(id);
    for (const { resource } of data.recipes[id].products) available.add(resource);
  }
  return ordered;
}

/** Find short, closed sets of recipes which consume `resource`. */
function findVoidPlans(
  resource: ResourceId,
  data: Pick<StaticData, 'recipes'>,
  index: RecipeIndex,
  maxResults = MAX_RESULTS,
): VoidPlan[] {
  const queue: SearchState[] = [{ recipes: [], dispose: [resource], supply: [] }];
  let queueIndex = 0;
  const seen = new Map<string, number>();
  const results: VoidPlan[] = [];

  while (queueIndex < queue.length && results.length < maxResults && seen.size < MAX_VISITED) {
    const state = queue[queueIndex++]!;
    if (state.dispose.length === 0 && state.supply.length === 0) {
      results.push({ recipes: executionOrder(state.recipes, resource, data) });
      continue;
    }
    if (state.recipes.length >= MAX_STEPS) continue;

    const disposing = state.dispose.length > 0;
    const target = (disposing ? state.dispose[0] : state.supply[0])!;
    const candidates = (disposing ? index.consumers : index.producers).get(target) ?? [];

    for (const id of candidates) {
      if (state.recipes.includes(id)) continue;
      const recipe = data.recipes[id];
      const products = terminal(recipe) ? [] : recipe.products.map((flow) => flow.resource);
      const otherProducts = products.filter((product) => disposing || product !== target);
      const otherIngredients = recipe.ingredients
        .map((flow) => flow.resource)
        .filter((ingredient) => !disposing || ingredient !== target);
      const next: SearchState = {
        recipes: [...state.recipes, id],
        dispose: unique([...state.dispose.slice(disposing ? 1 : 0), ...otherProducts]),
        supply: unique([...state.supply.slice(disposing ? 0 : 1), ...otherIngredients]).filter(
          (needed) => !otherProducts.includes(needed),
        ),
      };
      const key = stateKey(next);
      const previous = seen.get(key);
      if (previous !== undefined && previous <= next.recipes.length) continue;
      seen.set(key, next.recipes.length);
      queue.push(next);
    }
  }

  return results;
}

/**
 * Prepare a void-path finder for immutable recipe data.
 *
 * Building the reverse recipe indexes costs a full pass over the data, while both the indexes and
 * paths are independent of the UI state. Results are cached per resource and result limit so a
 * changed cell or search text does not repeat a potentially broad graph traversal.
 */
export function voidPlanFinder(data: Pick<StaticData, 'recipes'>) {
  const index = indexRecipes(data.recipes);
  const cached = new Map<string, VoidPlan[]>();

  return (resource: ResourceId, maxResults = MAX_RESULTS): VoidPlan[] => {
    const key = `${resource}\u0000${maxResults}`;
    const previous = cached.get(key);
    if (previous) return previous;

    const plans = findVoidPlans(resource, data, index, maxResults);
    cached.set(key, plans);
    return plans;
  };
}

/** Find short, closed sets of recipes which consume `resource`. */
export function voidPlans(
  resource: ResourceId,
  data: Pick<StaticData, 'recipes'>,
  maxResults = MAX_RESULTS,
): VoidPlan[] {
  return findVoidPlans(resource, data, indexRecipes(data.recipes), maxResults);
}
