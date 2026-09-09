import { cellInterface, scopeOf, type Cell } from '../../cell.ts';
import { staticData } from '../../data/decode.ts';
import { isBarrelling, isUnbarrelling, isVoid } from '../../data/recipes.ts';
import { parseSearch } from '../../search.ts';
import type { ResourceId } from '../../types.ts';
import {
  resourceChainFinder,
  voidPlanFinder,
  type ResourceChain,
  type VoidPlan,
} from '../../void-path.ts';
import { fromAirStages } from '../from-air.tsx';

export interface PathSuggestion {
  resource: ResourceId;
  kind: 'chain' | 'input' | 'output' | 'void';
  plan: ResourceChain | VoidPlan;
  score: number;
  scoreFactors: { inputs: number; outputs: number; buildings: number; certainty: number };
}
interface SynthesisedResourceChain extends ResourceChain {
  /** Number of free boundary inputs made internal by this suggestion. */
  synthesisedFreeInputs?: number;
}
const CANDIDATES_PER_RESOURCE = 24;
const MAX_SUGGESTIONS = 10;
export const suggestionScoreWeights = {
  step: 3,
  output: 4,
  inputComplexity: 6,
  reusedInput: 8,
  reusedOutput: 7,
  suppliedInput: 30,
  soleProducer: 50,
  twoRecipes: 30,
  threeRecipes: 20,
  freeInput: 100,
  synthesisedFreeInput: 10,
  void: 10,
} as const;
const staticVoidPlans = voidPlanFinder(staticData);
const staticResourceChains = resourceChainFinder(staticData);

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
const producers = indexRecipes('products');
const consumers = indexRecipes('ingredients');
const soleProducer = new Map(
  [...producers].flatMap(([resource, recipes]) =>
    recipes.length === 1 ? [[resource, recipes[0]!]] : [],
  ),
);
const soleConsumer = new Map(
  [...consumers].flatMap(([resource, recipes]) =>
    recipes.length === 1 ? [[resource, recipes[0]!]] : [],
  ),
);
const freeProductStages = fromAirStages(staticData).slice(0, 2);
const freeOneStepProducts = new Set(freeProductStages[1]?.flatMap(({ adds }) => adds) ?? []);
const freeRecipeByProduct = new Map(
  freeProductStages.flatMap((stage) =>
    stage.flatMap((recipe) => recipe.adds.map((product) => [product, recipe] as const)),
  ),
);

export function isResourceChain(plan: ResourceChain | VoidPlan): plan is ResourceChain {
  return 'target' in plan;
}
function isRecommendedPlan(plan: ResourceChain | VoidPlan) {
  return plan.recipes.every((id) => {
    const recipe = staticData.recipes[id];
    return recipe && !isBarrelling(recipe) && !isUnbarrelling(recipe);
  });
}
function isSingleStepVoidable(resource: ResourceId) {
  return staticVoidPlans(resource, 1)[0]?.recipes.length === 1;
}
function additionalCatalystInputs(
  plan: ResourceChain | VoidPlan,
  present: ReadonlySet<ResourceId>,
) {
  return [
    ...new Set(
      plan.recipes.flatMap((id) => {
        const recipe = staticData.recipes[id];
        if (!recipe) return [];
        const ingredients = new Set(recipe.ingredients.map(({ resource }) => resource));
        return recipe.products
          .filter(
            ({ resource, ignoredByProductivity }) =>
              ignoredByProductivity !== undefined || ingredients.has(resource),
          )
          .map(({ resource }) => resource);
      }),
    ),
  ].filter((resource) => !present.has(resource));
}
function calculateScoreFactors(
  plan: ResourceChain | VoidPlan,
  existingInputs: ReadonlySet<ResourceId>,
  existingOutputs: ReadonlySet<ResourceId>,
  present: ReadonlySet<ResourceId>,
  involvedRecipeCount = 0,
) {
  const inputs = isResourceChain(plan) ? plan.inputs : [];
  const outputs = isResourceChain(plan) ? plan.outputs : [];
  const allInputs = [
    ...inputs,
    ...additionalCatalystInputs(plan, present).filter((resource) => !inputs.includes(resource)),
  ];
  const inputComplexity = allInputs.reduce(
    (total, resource) => total + 1 + (staticData.resources[resource]?.complexity ?? 0),
    0,
  );
  return {
    inputs:
      -inputComplexity * suggestionScoreWeights.inputComplexity +
      allInputs.filter((resource) => existingInputs.has(resource)).length *
        suggestionScoreWeights.reusedInput,
    outputs:
      -outputs.filter((resource) => !isSingleStepVoidable(resource)).length *
        suggestionScoreWeights.output +
      outputs.filter((resource) => existingOutputs.has(resource)).length *
        suggestionScoreWeights.reusedOutput +
      (isResourceChain(plan) && existingInputs.has(plan.target)
        ? suggestionScoreWeights.suppliedInput
        : 0),
    buildings: -plan.recipes.length * suggestionScoreWeights.step,
    certainty:
      involvedRecipeCount === 1
        ? suggestionScoreWeights.soleProducer
        : involvedRecipeCount === 2
          ? suggestionScoreWeights.twoRecipes
          : involvedRecipeCount === 3
            ? suggestionScoreWeights.threeRecipes
            : 0,
  };
}
export function scoreRecipeSuggestion(
  plan: ResourceChain | VoidPlan,
  existingInputs: ReadonlySet<ResourceId>,
  existingOutputs: ReadonlySet<ResourceId>,
  present = new Set([...existingInputs, ...existingOutputs]),
  involvedRecipeCount = 0,
) {
  const factors = calculateScoreFactors(
    plan,
    existingInputs,
    existingOutputs,
    present,
    involvedRecipeCount,
  );
  return factors.inputs + factors.outputs + factors.buildings + factors.certainty;
}
function usedResources(search: string, cell?: Cell) {
  return parseSearch(search, cell ? scopeOf(cellInterface(cell)) : undefined).flatMap((term) =>
    term.kind === 'uses' ? [...term.resources] : [],
  );
}
export function suggestedVoidResources(search: string, cell?: Cell, resource?: ResourceId) {
  return [
    ...new Set([
      ...usedResources(search, cell),
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
    const producer = freeRecipeByProduct.get(resource);
    if (!producer) return false;
    if (!producer.recipe.ingredients.every(({ resource }) => addProducer(resource))) return false;
    for (const id of producer.recipes ?? [producer.id]) {
      if (!added.has(id)) {
        added.add(id);
        recipes.push(id);
      }
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
    const suggestion = directSuggestion(target, id, recipe);
    return [
      {
        ...suggestion,
        inputs: suggestion.inputs.filter((resource) => resource !== target),
        outputs: suggestion.outputs.filter((resource) => !suggestion.inputs.includes(resource)),
      },
    ];
  });
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
  return suggestedFewRecipeInterfaces(cell, 'outputs', consumers).map((suggestion) => ({
    ...suggestion,
    inputs: suggestion.inputs.filter((resource) => resource !== suggestion.target),
    outputs: suggestion.outputs.filter((resource) => !suggestion.inputs.includes(resource)),
  }));
}
function pathSuggestion(
  resource: ResourceId,
  kind: PathSuggestion['kind'],
  plan: ResourceChain | VoidPlan,
  inputs: ReadonlySet<ResourceId>,
  outputs: ReadonlySet<ResourceId>,
  present: ReadonlySet<ResourceId>,
  involvedRecipeCount = 0,
  isFreeInput = false,
): PathSuggestion {
  const scoreFactors = calculateScoreFactors(plan, inputs, outputs, present, involvedRecipeCount);
  if (isFreeInput) scoreFactors.certainty += suggestionScoreWeights.freeInput;
  if (isResourceChain(plan)) {
    scoreFactors.certainty +=
      ((plan as SynthesisedResourceChain).synthesisedFreeInputs ?? 0) *
      suggestionScoreWeights.synthesisedFreeInput;
  }
  if (kind === 'void') scoreFactors.certainty += suggestionScoreWeights.void;
  return {
    resource,
    kind,
    plan,
    score:
      scoreFactors.inputs + scoreFactors.outputs + scoreFactors.buildings + scoreFactors.certainty,
    scoreFactors,
  };
}
export function suggestedRecipePaths(
  search: string,
  cell?: Cell,
  resource?: ResourceId,
): PathSuggestion[] {
  const searched = new Set(usedResources(search, cell));
  const { inputs = [], outputs = [] } = cell ? cellInterface(cell) : {};
  const existingInputs = new Set([...freeOneStepProducts, ...searched, ...inputs]);
  const existingOutputs = new Set(outputs);
  const present = new Set([
    ...existingInputs,
    ...existingOutputs,
    ...(cell?.entries.flatMap(({ recipe: id }) => {
      const recipe = staticData.recipes[id];
      return recipe
        ? [...recipe.ingredients, ...recipe.products].map(({ resource }) => resource)
        : [];
    }) ?? []),
  ]);
  const chains = suggestedResourceChains(cell);
  const resourceSuggestions = suggestedVoidResources(search, cell, resource).flatMap((id) => {
    const plans = staticVoidPlans(id, CANDIDATES_PER_RESOURCE);
    const resourceChains = chains.get(id) ?? [];
    if (!searched.has(id) && id !== resource && !plans.length && !resourceChains.length) return [];
    return [
      ...plans
        .filter(isRecommendedPlan)
        .map((plan) => pathSuggestion(id, 'void', plan, existingInputs, existingOutputs, present)),
      ...resourceChains
        .filter(isRecommendedPlan)
        .map((plan) => pathSuggestion(id, 'chain', plan, existingInputs, existingOutputs, present)),
    ];
  });
  const inputSuggestions = suggestedSoleProducerInputs(cell).map((plan) =>
    pathSuggestion(plan.target, 'input', plan, existingInputs, existingOutputs, present, 1),
  );
  const freeInputSuggestions = suggestedFreeInputs(cell).map((plan) =>
    pathSuggestion(plan.target, 'input', plan, existingInputs, existingOutputs, present, 0, true),
  );
  const outputSuggestions = suggestedSoleConsumerOutputs(cell).map((plan) =>
    pathSuggestion(plan.target, 'output', plan, existingInputs, existingOutputs, present, 1),
  );
  const fewInputSuggestions = suggestedFewProducerInputs(cell).map((plan) =>
    pathSuggestion(
      plan.target,
      'input',
      plan,
      existingInputs,
      existingOutputs,
      present,
      producers.get(plan.target)?.length,
    ),
  );
  const fewOutputSuggestions = suggestedFewConsumerOutputs(cell).map((plan) =>
    pathSuggestion(
      plan.target,
      'output',
      plan,
      existingInputs,
      existingOutputs,
      present,
      consumers.get(plan.target)?.length,
    ),
  );
  const ranked = [
    ...resourceSuggestions,
    ...inputSuggestions,
    ...freeInputSuggestions,
    ...outputSuggestions,
    ...fewInputSuggestions,
    ...fewOutputSuggestions,
  ].toSorted(
    (a, b) =>
      b.score - a.score ||
      a.plan.recipes.length - b.plan.recipes.length ||
      a.resource.localeCompare(b.resource) ||
      a.plan.recipes.join('|').localeCompare(b.plan.recipes.join('|')),
  );
  const seen = new Set<string>();
  return ranked
    .filter(({ resource, kind, plan }) => {
      const key = `${resource}:${kind}:${plan.recipes.join('|')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);
}
