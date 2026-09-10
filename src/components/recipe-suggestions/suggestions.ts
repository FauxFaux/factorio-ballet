import { cellInterface, type Cell } from '../../cell.ts';
import { staticData } from '../../data/decode.ts';
import { isBarrelling, isUnbarrelling } from '../../data/recipes.ts';
import type { ResourceId } from '../../types.ts';
import { voidPlanFinder, type ResourceChain, type VoidPlan } from '../../void-path.ts';
import {
  consumerCount,
  isResourceChain,
  producerCount,
  suggestedFewConsumerOutputs,
  suggestedFewProducerInputs,
  suggestedFreeInputs,
  suggestedResourceChains,
  suggestedSoleConsumerOutputs,
  suggestedSoleProducerInputs,
  suggestedVoidResources,
  usedSearchResources,
  type SynthesisedResourceChain,
} from './suggestion-plans.ts';

export interface PathSuggestion {
  resource: ResourceId;
  kind: 'chain' | 'input' | 'output' | 'void';
  plan: ResourceChain | VoidPlan;
  score: number;
  scoreFactors: { inputs: number; outputs: number; buildings: number; certainty: number };
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
const freeOneStepProducts = new Set(staticData.suggestionPreload.fromAirOneStepProducts);
const singleStepVoidableResources = new Set(
  staticData.suggestionPreload.singleStepVoidableResources,
);

function isRecommendedPlan(plan: ResourceChain | VoidPlan) {
  return plan.recipes.every((id) => {
    const recipe = staticData.recipes[id];
    return recipe && !isBarrelling(recipe) && !isUnbarrelling(recipe);
  });
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
  const catalysts = [
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
  ].filter((resource) => !present.has(resource) && !inputs.includes(resource));
  const allInputs = [...inputs, ...catalysts];
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
      -outputs.filter((resource) => !singleStepVoidableResources.has(resource)).length *
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
  const searched = new Set(usedSearchResources(search, cell));
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
      producerCount(plan.target),
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
      consumerCount(plan.target),
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
