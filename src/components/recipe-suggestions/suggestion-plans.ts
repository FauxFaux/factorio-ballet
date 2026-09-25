import { cellInterface, scopeOf, type Cell } from '../../cell.ts';
import { parseSearch } from '../../data/search.ts';
import type { ResourceId, StaticData } from '../../types.ts';
import type { ResourceChain, VoidPlan } from '../../compute/void-path.ts';
import type { SuggestionPlanIndex } from '../../dataset/precompute.ts';

export interface SynthesisedResourceChain extends ResourceChain {
  /** Number of free boundary inputs made internal by this suggestion. */
  synthesisedFreeInputs?: number;
}

const CANDIDATES_PER_RESOURCE = 24;

export function isResourceChain(plan: ResourceChain | VoidPlan): plan is ResourceChain {
  return 'target' in plan;
}

export function usedSearchResources(data: StaticData, search: string, cell?: Cell) {
  return parseSearch(data, search, cell ? scopeOf(cellInterface(data, cell)) : undefined).flatMap(
    (term) => (term.kind === 'uses' ? [...term.resources] : []),
  );
}

export function suggestedVoidResources(
  data: StaticData,
  search: string,
  cell?: Cell,
  resource?: ResourceId,
) {
  return [
    ...new Set([
      ...usedSearchResources(data, search, cell),
      ...(resource ? [resource] : []),
      ...(cell ? cellInterface(data, cell).outputs : []),
    ]),
  ];
}

export function suggestedResourceChains(
  data: StaticData,
  index: SuggestionPlanIndex,
  cell?: Cell,
  maxResults = CANDIDATES_PER_RESOURCE,
): Map<ResourceId, ResourceChain[]> {
  if (!cell) return new Map();
  const { inputs, outputs } = cellInterface(data, cell);
  return new Map(
    outputs
      .map((output) => [output, index.resourceChains(output, inputs, maxResults)] as const)
      .filter(([, chains]) => chains.length),
  );
}

function directSuggestion(target: ResourceId, id: string, recipe: StaticData['recipes'][string]) {
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

export function suggestedSoleProducerInputs(
  data: StaticData,
  index: SuggestionPlanIndex,
  cell?: Cell,
): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(data, cell).inputs.flatMap((target) => {
    const id = index.soleProducer.get(target);
    const recipe = id && data.recipes[id];
    return id && recipe ? [directSuggestion(target, id, recipe)] : [];
  });
}

/**
 * Recipes in the first two from-air stages need no meaningful cell input: a pump can supply water,
 * and that water can immediately be turned into steam. Keep their actual recipes so the suggestion
 * can be added to a cell, rather than merely treating their product as already available.
 */
export function suggestedFreeInputs(
  data: StaticData,
  index: SuggestionPlanIndex,
  cell?: Cell,
): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(data, cell).inputs.flatMap((target) => {
    const plan = freeInputPlan(data, index, target);
    return plan ? [plan] : [];
  });
}

function freeInputPlan(
  data: StaticData,
  index: SuggestionPlanIndex,
  target: ResourceId,
): ResourceChain | undefined {
  const recipes: string[] = [];
  const added = new Set<string>();
  const addProducer = (resource: ResourceId): boolean => {
    const id = index.freeRecipeByProduct.get(resource);
    const producer = id && data.recipes[id];
    if (!producer) return false;
    if (!producer.ingredients.every(({ resource }) => addProducer(resource))) return false;
    if (!added.has(id)) {
      added.add(id);
      recipes.push(id);
    }
    return true;
  };
  if (!addProducer(target)) return undefined;
  return recipePlan(data, target, recipes);
}

/** Calculate the boundary flows for a recipe set which makes `target`. */
function recipePlan(data: StaticData, target: ResourceId, recipes: string[]): ResourceChain {
  const used = new Set(
    recipes.flatMap((id) => data.recipes[id]?.ingredients.map(({ resource }) => resource) ?? []),
  );
  const made = new Set(
    recipes.flatMap((id) => data.recipes[id]?.products.map(({ resource }) => resource) ?? []),
  );
  return {
    target,
    recipes,
    inputs: [...used].filter((resource) => !made.has(resource)),
    outputs: [...made].filter((resource) => resource !== target && !used.has(resource)),
  };
}

export function suggestedSoleConsumerOutputs(
  data: StaticData,
  index: SuggestionPlanIndex,
  cell?: Cell,
): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(data, cell).outputs.flatMap((target) => {
    const id = index.soleConsumer.get(target);
    const recipe = id && data.recipes[id];
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
  data: StaticData,
  cell: Cell | undefined,
  direction: 'inputs' | 'outputs',
  recipesByResource: ReadonlyMap<ResourceId, readonly string[]>,
): ResourceChain[] {
  if (!cell) return [];
  return cellInterface(data, cell)[direction].flatMap((target) => {
    const recipes = recipesByResource.get(target);
    if (!recipes || recipes.length < 2 || recipes.length > 3) return [];
    return recipes.flatMap((id) => {
      const recipe = data.recipes[id];
      return recipe ? [directSuggestion(target, id, recipe)] : [];
    });
  });
}

export function suggestedFewProducerInputs(
  data: StaticData,
  index: SuggestionPlanIndex,
  cell?: Cell,
): ResourceChain[] {
  return suggestedFewRecipeInterfaces(data, cell, 'inputs', index.producers).flatMap((plan) => [
    plan,
    ...plan.inputs.flatMap((input) => {
      const supply = freeInputPlan(data, index, input);
      return supply
        ? [
            {
              ...recipePlan(data, plan.target, [...supply.recipes, ...plan.recipes]),
              synthesisedFreeInputs: 1,
            },
          ]
        : [];
    }),
  ]);
}

export function suggestedFewConsumerOutputs(
  data: StaticData,
  index: SuggestionPlanIndex,
  cell?: Cell,
): ResourceChain[] {
  return suggestedFewRecipeInterfaces(data, cell, 'outputs', index.consumers).map(
    withoutTargetInput,
  );
}

export function producerCount(index: SuggestionPlanIndex, resource: ResourceId) {
  return index.producers.get(resource)?.length;
}

export function consumerCount(index: SuggestionPlanIndex, resource: ResourceId) {
  return index.consumers.get(resource)?.length;
}
