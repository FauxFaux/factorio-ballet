import { cellInterface, scopeOf, type Cell } from '../../cell.ts';
import { staticData } from '../../data/index.ts';
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
const CANDIDATES_PER_RESOURCE = 24;
const MAX_SUGGESTIONS = 10;
export const suggestionScoreWeights = {
  step: 10,
  output: 4,
  inputComplexity: 6,
  reusedInput: 8,
  reusedOutput: 7,
  suppliedInput: 30,
  soleProducer: 50,
} as const;
const staticVoidPlans = voidPlanFinder(staticData);
const staticResourceChains = resourceChainFinder(staticData);

function indexSoleRecipes(direction: 'ingredients' | 'products') {
  const recipes = new Map<ResourceId, string>();
  const ambiguous = new Set<ResourceId>();
  for (const [id, recipe] of Object.entries(staticData.recipes)) {
    if (isVoid(recipe) || isBarrelling(recipe) || isUnbarrelling(recipe)) continue;
    for (const resource of new Set(recipe[direction].map(({ resource }) => resource))) {
      if (ambiguous.has(resource)) continue;
      if (recipes.has(resource)) {
        recipes.delete(resource);
        ambiguous.add(resource);
      } else recipes.set(resource, id);
    }
  }
  return recipes;
}
const soleProducer = indexSoleRecipes('products');
const soleConsumer = indexSoleRecipes('ingredients');
const freeOneStepProducts = new Set(
  fromAirStages(staticData)[1]?.flatMap(({ adds }) => adds) ?? [],
);

export function isResourceChain(plan: ResourceChain | VoidPlan): plan is ResourceChain {
  return 'target' in plan;
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
  sole = false,
) {
  const inputs = isResourceChain(plan) ? plan.inputs : [];
  const outputs = isResourceChain(plan) ? plan.outputs : [];
  const allInputs = [
    ...inputs,
    ...additionalCatalystInputs(plan, present).filter((resource) => !inputs.includes(resource)),
  ];
  const inputComplexity = allInputs.reduce(
    (total, resource) => total + (staticData.resources[resource]?.complexity ?? 1),
    0,
  );
  return {
    inputs:
      -inputComplexity * suggestionScoreWeights.inputComplexity +
      allInputs.filter((resource) => existingInputs.has(resource)).length *
        suggestionScoreWeights.reusedInput +
      (isResourceChain(plan) && existingInputs.has(plan.target)
        ? suggestionScoreWeights.suppliedInput
        : 0),
    outputs:
      -outputs.filter((resource) => !isSingleStepVoidable(resource)).length *
        suggestionScoreWeights.output +
      outputs.filter((resource) => existingOutputs.has(resource)).length *
        suggestionScoreWeights.reusedOutput,
    buildings: -plan.recipes.length * suggestionScoreWeights.step,
    certainty: sole ? suggestionScoreWeights.soleProducer : 0,
  };
}
export function scoreRecipeSuggestion(
  plan: ResourceChain | VoidPlan,
  existingInputs: ReadonlySet<ResourceId>,
  existingOutputs: ReadonlySet<ResourceId>,
  present = new Set([...existingInputs, ...existingOutputs]),
  sole = false,
) {
  const factors = calculateScoreFactors(plan, existingInputs, existingOutputs, present, sole);
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
function pathSuggestion(
  resource: ResourceId,
  kind: PathSuggestion['kind'],
  plan: ResourceChain | VoidPlan,
  inputs: ReadonlySet<ResourceId>,
  outputs: ReadonlySet<ResourceId>,
  present: ReadonlySet<ResourceId>,
  sole = false,
): PathSuggestion {
  const scoreFactors = calculateScoreFactors(plan, inputs, outputs, present, sole);
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
      ...plans.map((plan) =>
        pathSuggestion(id, 'void', plan, existingInputs, existingOutputs, present),
      ),
      ...resourceChains.map((plan) =>
        pathSuggestion(id, 'chain', plan, existingInputs, existingOutputs, present),
      ),
    ];
  });
  const inputSuggestions = suggestedSoleProducerInputs(cell).map((plan) =>
    pathSuggestion(plan.target, 'input', plan, existingInputs, existingOutputs, present, true),
  );
  const outputSuggestions = suggestedSoleConsumerOutputs(cell).map((plan) =>
    pathSuggestion(plan.target, 'output', plan, existingInputs, existingOutputs, present, true),
  );
  return [...resourceSuggestions, ...inputSuggestions, ...outputSuggestions]
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        a.plan.recipes.length - b.plan.recipes.length ||
        a.resource.localeCompare(b.resource) ||
        a.plan.recipes.join('|').localeCompare(b.plan.recipes.join('|')),
    )
    .slice(0, MAX_SUGGESTIONS);
}
