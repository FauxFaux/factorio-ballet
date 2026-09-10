import { cellInterface, scopeOf, type Cell } from '../../cell.ts';
import { staticData } from '../../data/decode.ts';
import { isBarrelling, isUnbarrelling, isVoid } from '../../data/recipes.ts';
import { parseSearch } from '../../search.ts';
import type { ResourceId } from '../../types.ts';
import { resourceChainFinder, type ResourceChain, type VoidPlan } from '../../void-path.ts';

export interface SynthesisedResourceChain extends ResourceChain {
  /** Number of free boundary inputs made internal by this suggestion. */
  synthesisedFreeInputs?: number;
}

const CANDIDATES_PER_RESOURCE = 24;
const staticResourceChains = resourceChainFinder(staticData);
const producers = indexRecipes('products');
const consumers = indexRecipes('ingredients');
const soleProducer = uniqueRecipes(producers);
const soleConsumer = uniqueRecipes(consumers);
const freeRecipeByProduct = new Map(
  Object.entries(staticData.suggestionPreload.fromAirRecipeByProduct) as [ResourceId, string][],
);

function indexRecipes(direction: 'ingredients' | 'products') {
  const recipes = new Map<ResourceId, string[]>();
  for (const [id, recipe] of Object.entries(staticData.recipes)) {
    if (isVoid(recipe) || isBarrelling(recipe) || isUnbarrelling(recipe)) continue;
    for (const resource of new Set(recipe[direction].map(({ resource }) => resource))) {
      const indexed = recipes.get(resource);
      if (indexed) indexed.push(id);
      else recipes.set(resource, [id]);
    }
  }
  return recipes;
}

function uniqueRecipes(recipesByResource: ReadonlyMap<ResourceId, readonly string[]>) {
  return new Map(
    [...recipesByResource].flatMap(([resource, recipes]) =>
      recipes.length === 1 ? [[resource, recipes[0]!]] : [],
    ),
  );
}

export function isResourceChain(plan: ResourceChain | VoidPlan): plan is ResourceChain {
  return 'target' in plan;
}

export function usedSearchResources(search: string, cell?: Cell) {
  return parseSearch(search, cell ? scopeOf(cellInterface(cell)) : undefined).flatMap((term) =>
    term.kind === 'uses' ? [...term.resources] : [],
  );
}

export function suggestedVoidResources(search: string, cell?: Cell, resource?: ResourceId) {
  return [
    ...new Set([
      ...usedSearchResources(search, cell),
      ...(resource ? [resource] : []),
      ...(cell ? cellInterface(cell).outputs : []),
    ]),
  ];
}

export function suggestedResourceChains(
  cell?: Cell,
  maxResults = CANDIDATES_PER_RESOURCE,
): Map<ResourceId, ResourceChain[]> {
  if (!cell) return new Map();
  const { inputs, outputs } = cellInterface(cell);
  return new Map(
    outputs
      .map((output) => [output, staticResourceChains(output, inputs, maxResults)] as const)
      .filter(([, chains]) => chains.length),
  );
}

function directSuggestion(
  target: ResourceId,
  id: string,
  recipe: (typeof staticData.recipes)[string],
) {
  const inputs = [...new Set(recipe.ingredients.map(({ resource }) => resource))];
  return {
    target,
    recipes: [id],
    inputs,
    outputs: [...new Set(recipe.products.map(({ resource }) => resource))].filter(
      (resource) => resource !== target && !inputs.includes(resource),
    ),
  };
}

export function suggestedSoleProducerInputs(cell?: Cell): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(cell).inputs.flatMap((target) => {
    const id = soleProducer.get(target);
    const recipe = id && staticData.recipes[id];
    return id && recipe ? [directSuggestion(target, id, recipe)] : [];
  });
}

/**
 * Recipes in the first two from-air stages need no meaningful cell input: a pump can supply water,
 * and that water can immediately be turned into steam. Keep their actual recipes so the suggestion
 * can be added to a cell, rather than merely treating their product as already available.
 */
export function suggestedFreeInputs(cell?: Cell): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(cell).inputs.flatMap((target) => {
    const plan = freeInputPlan(target);
    return plan ? [plan] : [];
  });
}

function freeInputPlan(target: ResourceId): ResourceChain | undefined {
  const recipes: string[] = [];
  const added = new Set<string>();
  const addProducer = (resource: ResourceId): boolean => {
    const id = freeRecipeByProduct.get(resource);
    const producer = id && staticData.recipes[id];
    if (!producer) return false;
    if (!producer.ingredients.every(({ resource }) => addProducer(resource))) return false;
    if (!added.has(id)) {
      added.add(id);
      recipes.push(id);
    }
    return true;
  };
  if (!addProducer(target)) return undefined;
  return recipePlan(target, recipes);
}

/** Calculate the boundary flows for a recipe set which makes `target`. */
function recipePlan(target: ResourceId, recipes: string[]): ResourceChain {
  const used = new Set(
    recipes.flatMap(
      (id) => staticData.recipes[id]?.ingredients.map(({ resource }) => resource) ?? [],
    ),
  );
  const made = new Set(
    recipes.flatMap((id) => staticData.recipes[id]?.products.map(({ resource }) => resource) ?? []),
  );
  return {
    target,
    recipes,
    inputs: [...used].filter((resource) => !made.has(resource)),
    outputs: [...made].filter((resource) => resource !== target && !used.has(resource)),
  };
}

export function suggestedSoleConsumerOutputs(cell?: Cell): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(cell).outputs.flatMap((target) => {
    const id = soleConsumer.get(target);
    const recipe = id && staticData.recipes[id];
    if (!id || !recipe) return [];
    return [withoutTargetInput(directSuggestion(target, id, recipe))];
  });
}

function withoutTargetInput(suggestion: ResourceChain): ResourceChain {
  const inputs = suggestion.inputs.filter((resource) => resource !== suggestion.target);
  return {
    ...suggestion,
    inputs,
    outputs: suggestion.outputs.filter((resource) => !inputs.includes(resource)),
  };
}

function suggestedFewRecipeInterfaces(
  cell: Cell | undefined,
  direction: 'inputs' | 'outputs',
  recipesByResource: ReadonlyMap<ResourceId, readonly string[]>,
): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(cell)[direction].flatMap((target) => {
    const recipes = recipesByResource.get(target);
    if (!recipes || recipes.length < 2 || recipes.length > 3) return [];
    return recipes.flatMap((id) => {
      const recipe = staticData.recipes[id];
      return recipe ? [directSuggestion(target, id, recipe)] : [];
    });
  });
}

export function suggestedFewProducerInputs(cell?: Cell): ResourceChain[] {
  return suggestedFewRecipeInterfaces(cell, 'inputs', producers).flatMap((plan) => [
    plan,
    ...plan.inputs.flatMap((input) => {
      const supply = freeInputPlan(input);
      return supply
        ? [
            {
              ...recipePlan(plan.target, [...supply.recipes, ...plan.recipes]),
              synthesisedFreeInputs: 1,
            },
          ]
        : [];
    }),
  ]);
}

export function suggestedFewConsumerOutputs(cell?: Cell): ResourceChain[] {
  return suggestedFewRecipeInterfaces(cell, 'outputs', consumers).map(withoutTargetInput);
}

export function producerCount(resource: ResourceId) {
  return producers.get(resource)?.length;
}

export function consumerCount(resource: ResourceId) {
  return consumers.get(resource)?.length;
}
