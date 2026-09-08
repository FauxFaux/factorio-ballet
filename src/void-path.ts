import { isVoid } from './data/recipes.ts';
import type { Recipe, ResourceId, StaticData } from './types.ts';

export interface VoidPlan {
  recipes: string[];
}

/** A short route from one cell edge to another, leaving its side flows at the boundary. */
export interface ResourceChain extends VoidPlan {
  target: ResourceId;
  /** Resources the chain still needs after its source and recipe hand-offs are removed. */
  inputs: ResourceId[];
  /** Byproducts left after its target and recipe hand-offs are removed. */
  outputs: ResourceId[];
}

interface SearchState extends VoidPlan {
  dispose: ResourceId[];
  supply: ResourceId[];
}

interface RecipeIndex {
  consumers: Map<ResourceId, string[]>;
  producers: Map<ResourceId, string[]>;
}

interface ChainState {
  recipes: string[];
  resource: ResourceId;
  seen: Set<ResourceId>;
  complexity: number;
}

const MAX_STEPS = 9;
const MAX_RESULTS = 8;
const MAX_VISITED = 50_000;
const MAX_CHAIN_STEPS = 6;
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

/** The boundary flows left by a chain once its source, target, and internal hand-offs are hidden. */
function chainEffects(
  recipes: string[],
  source: ResourceId,
  target: ResourceId,
  data: Pick<StaticData, 'recipes'>,
) {
  const used = new Set<ResourceId>();
  const made = new Set<ResourceId>();
  for (const id of recipes) {
    const recipe = data.recipes[id]!;
    for (const { resource } of recipe.ingredients) used.add(resource);
    for (const { resource } of recipe.products) made.add(resource);
  }
  const isExtra = (resource: ResourceId) => resource !== source && resource !== target;
  return {
    inputs: [...used].filter((resource) => isExtra(resource) && !made.has(resource)),
    outputs: [...made].filter((resource) => isExtra(resource) && !used.has(resource)),
  };
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

/**
 * Prepare a finder for short chains which turn `source` into one of `targets`.
 *
 * Unlike void paths, these chains intentionally leave their other inputs and products open: those
 * are the small extra boundary flows a user can decide whether to accept.  Exploring the simpler
 * side flows first makes a chain which consumes a troublesome output and supplies a wanted input
 * appear before a technically possible but expensive detour.
 */
export function resourceChainFinder(
  data: Pick<StaticData, 'recipes'> & Partial<Pick<StaticData, 'resources'>>,
) {
  const index = indexRecipes(data.recipes);
  const cached = new Map<string, ResourceChain[]>();

  return (source: ResourceId, targets: Iterable<ResourceId>, maxResults = MAX_RESULTS) => {
    const wanted = new Set(targets);
    if (!wanted.size || wanted.has(source)) return [];

    const targetKey = [...wanted].sort().join(',');
    const key = `${source}\u0000${targetKey}\u0000${maxResults}`;
    const previous = cached.get(key);
    if (previous) return previous;

    const queue: ChainState[] = [
      { recipes: [], resource: source, seen: new Set([source]), complexity: 0 },
    ];
    const results: ResourceChain[] = [];
    let queueIndex = 0;

    while (queueIndex < queue.length && results.length < maxResults && queueIndex < MAX_VISITED) {
      const state = queue[queueIndex++]!;
      if (state.recipes.length >= MAX_CHAIN_STEPS) continue;

      const next = (index.consumers.get(state.resource) ?? [])
        .filter((id) => !state.recipes.includes(id))
        .flatMap((id) => {
          const recipe = data.recipes[id]!;
          return recipe.products
            .filter(({ resource }) => !state.seen.has(resource))
            .map(({ resource }) => {
              const sideFlows = [
                ...recipe.ingredients.filter(({ resource: id }) => id !== state.resource),
                ...recipe.products.filter(({ resource: id }) => id !== resource),
              ];
              return {
                id,
                resource,
                complexity:
                  state.complexity +
                  sideFlows.reduce(
                    (total, { resource: id }) => total + (data.resources?.[id]?.complexity ?? 1),
                    0,
                  ),
              };
            });
        })
        .sort((a, b) => a.complexity - b.complexity || a.id.localeCompare(b.id));

      for (const candidate of next) {
        const recipes = [...state.recipes, candidate.id];
        if (wanted.has(candidate.resource)) {
          results.push({
            recipes,
            target: candidate.resource,
            ...chainEffects(recipes, source, candidate.resource, data),
          });
          if (results.length >= maxResults) break;
        } else {
          queue.push({
            recipes,
            resource: candidate.resource,
            seen: new Set([...state.seen, candidate.resource]),
            complexity: candidate.complexity,
          });
        }
      }
    }

    cached.set(key, results);
    return results;
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
