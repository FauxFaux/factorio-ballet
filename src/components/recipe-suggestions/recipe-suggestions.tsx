import './recipe-suggestions.css';
import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import { cellInterface, scopeOf, type Cell } from '../../cell.ts';
import { recipeName, resourceName, staticData } from '../../data/index.ts';
import type { ResourceId } from '../../types.ts';
import { parseSearch } from '../../search.ts';
import {
  resourceChainFinder,
  voidPlanFinder,
  type ResourceChain,
  type VoidPlan,
} from '../../void-path.ts';
import { CompactRecipe } from '../compact-recipe.tsx';
import { fromAirStages } from '../from-air.tsx';
import { ResourceIcon } from '../resource.tsx';

interface PathSuggestion {
  resource: ResourceId;
  kind: 'chain' | 'input' | 'output' | 'void';
  plan: ResourceChain | VoidPlan;
  score: number;
  scoreFactors: SuggestionScoreFactors;
}

interface SuggestionScoreFactors {
  inputs: number;
  outputs: number;
  buildings: number;
  certainty: number;
}

const CANDIDATES_PER_RESOURCE = 24;
const MAX_SUGGESTIONS = 10;

/** Keep these deliberately visible: we expect to tune them after looking at real path rankings. */
export const suggestionScoreWeights = {
  step: 10,
  output: 4,
  inputComplexity: 6,
  reusedInput: 8,
  reusedOutput: 7,
  suppliedInput: 30,
  soleProducer: 50,
} as const;

// Recipe data is loaded once and immutable. Index it and retain each completed path search instead
// of redoing a full recipe-data pass whenever the current cell changes.
const staticVoidPlans = voidPlanFinder(staticData);
const staticResourceChains = resourceChainFinder(staticData);

/** The one recipe which makes or uses a resource, omitting resources with competing recipes. */
function indexSoleRecipes(direction: 'ingredients' | 'products'): Map<ResourceId, string> {
  const producers = new Map<ResourceId, string>();
  const ambiguous = new Set<ResourceId>();
  for (const [id, recipe] of Object.entries(staticData.recipes)) {
    for (const resource of new Set(recipe[direction].map(({ resource }) => resource))) {
      if (ambiguous.has(resource)) continue;
      if (producers.has(resource)) {
        producers.delete(resource);
        ambiguous.add(resource);
      } else {
        producers.set(resource, id);
      }
    }
  }
  return producers;
}

const soleProducer = indexSoleRecipes('products');
const soleConsumer = indexSoleRecipes('ingredients');

function isSingleStepVoidable(resource: ResourceId): boolean {
  return staticVoidPlans(resource, 1)[0]?.recipes.length === 1;
}

// Stage one makes water and compressed air without inputs. Treat the products newly unlocked by
// stage two (such as oxygen) as available when comparing the extra inputs a path needs.
const freeOneStepProducts = new Set(
  fromAirStages(staticData)[1]?.flatMap(({ adds }) => adds) ?? [],
);

function isResourceChain(plan: ResourceChain | VoidPlan): plan is ResourceChain {
  return 'target' in plan;
}

/**
 * A catalyst is returned by a recipe, so it disappears from a path's net boundary flows. It still
 * has to be available to start the path, unless the cell already has it.
 */
function additionalCatalystInputs(
  plan: ResourceChain | VoidPlan,
  existingResources: ReadonlySet<ResourceId>,
): ResourceId[] {
  return [
    ...new Set(
      plan.recipes.flatMap((id) => {
        const recipe = staticData.recipes[id];
        if (!recipe) return [];
        const ingredientResources = new Set(recipe.ingredients.map(({ resource }) => resource));
        return recipe.products
          .filter(
            ({ resource, ignoredByProductivity }) =>
              ignoredByProductivity !== undefined || ingredientResources.has(resource),
          )
          .map(({ resource }) => resource);
      }),
    ),
  ].filter((resource) => !existingResources.has(resource));
}

/**
 * Rank a path by the boundary flows it adds to a cell. Closed void paths have no extra boundary
 * flows, while chains are rewarded for joining edges the cell already has.
 */
export function scoreRecipeSuggestion(
  plan: ResourceChain | VoidPlan,
  existingInputs: ReadonlySet<ResourceId>,
  existingOutputs: ReadonlySet<ResourceId>,
  presentResources = new Set([...existingInputs, ...existingOutputs]),
  isSoleProducer = false,
): number {
  const { inputs, outputs, buildings, certainty } = scoreRecipeSuggestionFactors(
    plan,
    existingInputs,
    existingOutputs,
    presentResources,
    isSoleProducer,
  );

  return inputs + outputs + buildings + certainty;
}

function scoreRecipeSuggestionFactors(
  plan: ResourceChain | VoidPlan,
  existingInputs: ReadonlySet<ResourceId>,
  existingOutputs: ReadonlySet<ResourceId>,
  presentResources: ReadonlySet<ResourceId>,
  isSoleProducer = false,
): SuggestionScoreFactors {
  const inputs = isResourceChain(plan) ? plan.inputs : [];
  const outputs = isResourceChain(plan) ? plan.outputs : [];
  const catalystInputs = additionalCatalystInputs(plan, presentResources).filter(
    (resource) => !inputs.includes(resource),
  );
  const allInputs = [...inputs, ...catalystInputs];
  const reusedInputs = allInputs.filter((resource) => existingInputs.has(resource)).length;
  const reusedOutputs = outputs.filter((resource) => existingOutputs.has(resource)).length;
  const suppliesInput = isResourceChain(plan) && existingInputs.has(plan.target);
  const inputComplexity = allInputs.reduce(
    (total, resource) => total + (staticData.resources[resource]?.complexity ?? 1),
    0,
  );

  return {
    inputs:
      -inputComplexity * suggestionScoreWeights.inputComplexity +
      reusedInputs * suggestionScoreWeights.reusedInput +
      (suppliesInput ? suggestionScoreWeights.suppliedInput : 0),
    outputs:
      -outputs.filter((resource) => !isSingleStepVoidable(resource)).length *
        suggestionScoreWeights.output +
      reusedOutputs * suggestionScoreWeights.reusedOutput,
    buildings: -plan.recipes.length * suggestionScoreWeights.step,
    certainty: isSoleProducer ? suggestionScoreWeights.soleProducer : 0,
  };
}

function usedResources(search: string, cell?: Cell): ResourceId[] {
  const scope = cell ? scopeOf(cellInterface(cell)) : undefined;
  return parseSearch(search, scope).flatMap((term) =>
    term.kind === 'uses' ? [...term.resources] : [],
  );
}

/** Resources named by `uses:` terms, a selected resource, then the cell's outputs. */
export function suggestedVoidResources(
  search: string,
  cell?: Cell,
  resource?: ResourceId,
): ResourceId[] {
  const searched = usedResources(search, cell);
  const outputs = cell ? cellInterface(cell).outputs : [];
  return [...new Set([...searched, ...(resource ? [resource] : []), ...outputs])];
}

/** Short routes from a cell output to one of the resources it currently needs. */
export function suggestedResourceChains(
  cell?: Cell,
  maxResults = CANDIDATES_PER_RESOURCE,
): Map<ResourceId, ResourceChain[]> {
  if (!cell) return new Map();
  const { inputs, outputs } = cellInterface(cell);
  return new Map(
    outputs
      .map((output) => [output, staticResourceChains(output, inputs, maxResults)] as const)
      .filter(([, chains]) => chains.length > 0),
  );
}

/** The one available recipe for each input the cell must otherwise import. */
export function suggestedSoleProducerInputs(cell?: Cell): ResourceChain[] {
  if (!cell) return [];

  return cellInterface(cell).inputs.flatMap((target) => {
    const id = soleProducer.get(target);
    const recipe = id && staticData.recipes[id];
    if (!id || !recipe) return [];

    const inputs = [...new Set(recipe.ingredients.map(({ resource }) => resource))];
    return [
      {
        target,
        recipes: [id],
        inputs,
        outputs: [...new Set(recipe.products.map(({ resource }) => resource))].filter(
          (resource) => resource !== target && !inputs.includes(resource),
        ),
      },
    ];
  });
}

/** The one available recipe for each output the cell must otherwise export. */
export function suggestedSoleConsumerOutputs(cell?: Cell): ResourceChain[] {
  if (!cell) return [];

  return cellInterface(cell).outputs.flatMap((source) => {
    const id = soleConsumer.get(source);
    const recipe = id && staticData.recipes[id];
    if (!id || !recipe) return [];

    const ingredients = [...new Set(recipe.ingredients.map(({ resource }) => resource))];
    return [
      {
        // ResourceChain supplies its target. The source is a useful stand-in here because this
        // direct recipe consumes an output rather than supplying an input.
        target: source,
        recipes: [id],
        inputs: ingredients.filter((resource) => resource !== source),
        outputs: [...new Set(recipe.products.map(({ resource }) => resource))].filter(
          (resource) => !ingredients.includes(resource),
        ),
      },
    ];
  });
}

/** The ten most useful paths across the resources currently in view. */
export function suggestedRecipePaths(
  search: string,
  cell?: Cell,
  resource?: ResourceId,
): PathSuggestion[] {
  const searched = new Set(usedResources(search, cell));
  const { inputs = [], outputs = [] } = cell ? cellInterface(cell) : {};
  const existingInputs = new Set([...freeOneStepProducts, ...searched, ...inputs]);
  const existingOutputs = new Set(outputs);
  const presentResources = new Set([
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
  const soleProducerInputs = suggestedSoleProducerInputs(cell);
  const soleConsumerOutputs = suggestedSoleConsumerOutputs(cell);

  const resourceSuggestions = suggestedVoidResources(search, cell, resource).flatMap((id) => {
    const plans = staticVoidPlans(id, CANDIDATES_PER_RESOURCE);
    const resourceChains = chains.get(id) ?? [];
    if (!searched.has(id) && id !== resource && plans.length === 0 && resourceChains.length === 0) {
      return [];
    }
    return [
      ...plans.map((plan) => {
        const scoreFactors = scoreRecipeSuggestionFactors(
          plan,
          existingInputs,
          existingOutputs,
          presentResources,
        );
        return {
          resource: id,
          kind: 'void' as const,
          plan,
          score:
            scoreFactors.inputs +
            scoreFactors.outputs +
            scoreFactors.buildings +
            scoreFactors.certainty,
          scoreFactors,
        };
      }),
      ...resourceChains.map((plan) => {
        const scoreFactors = scoreRecipeSuggestionFactors(
          plan,
          existingInputs,
          existingOutputs,
          presentResources,
        );
        return {
          resource: id,
          kind: 'chain' as const,
          plan,
          score:
            scoreFactors.inputs +
            scoreFactors.outputs +
            scoreFactors.buildings +
            scoreFactors.certainty,
          scoreFactors,
        };
      }),
    ];
  });
  const inputSuggestions = soleProducerInputs.map((plan) => {
    const scoreFactors = scoreRecipeSuggestionFactors(
      plan,
      existingInputs,
      existingOutputs,
      presentResources,
      true,
    );
    return {
      resource: plan.target,
      kind: 'input' as const,
      plan,
      score:
        scoreFactors.inputs +
        scoreFactors.outputs +
        scoreFactors.buildings +
        scoreFactors.certainty,
      scoreFactors,
    };
  });
  const outputSuggestions = soleConsumerOutputs.map((plan) => {
    const scoreFactors = scoreRecipeSuggestionFactors(
      plan,
      existingInputs,
      existingOutputs,
      presentResources,
      true,
    );
    return {
      resource: plan.target,
      kind: 'output' as const,
      plan,
      score:
        scoreFactors.inputs +
        scoreFactors.outputs +
        scoreFactors.buildings +
        scoreFactors.certainty,
      scoreFactors,
    };
  });

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

export function RecipeSuggestions({
  resource,
  search,
  cell,
  progress,
}: {
  /** A resource explicitly selected from a normal resource search. */
  resource?: ResourceId;
  /** The query currently shown in {@link RecipeList}. */
  search: string;
  /** The cell being edited, whose outputs may be worth disposing of. */
  cell?: Cell;
  progress: number;
}) {
  const suggestions = useMemo(
    () => suggestedRecipePaths(search, cell, resource),
    [search, cell, resource],
  );

  return (
    <section class="void-path" aria-label="Recipe paths">
      <h2>Top recipe paths</h2>
      {suggestions.length === 0 ? (
        <p class="void-path-hint">
          Search for recipes using a resource to find ways to void it or feed a cell input.
        </p>
      ) : (
        suggestions.map(({ resource, kind, plan, score, scoreFactors }) => (
          <article key={`${resource}:${kind}:${plan.recipes.join('|')}`} class="void-path-tile">
            <div class="recipe-card void-path-card">
              <div class="void-path-card-head">
                <h3 class="void-path-for">
                  <ResourceIcon id={resource} /> {resourceName(resource)}
                </h3>
                <p class="void-path-score">Score {score.toFixed(1)}</p>
              </div>
              {(kind === 'chain' || kind === 'input') && isResourceChain(plan) && (
                <p class="void-path-flow-summary">
                  <ResourceList resources={plan.inputs} label="Needs" />
                  <span class="void-path-flow-arrow" aria-label="makes">
                    ➔
                  </span>
                  <ResourceList resources={[plan.target]} label="Makes" />
                  {plan.outputs.length > 0 && (
                    <>
                      <span class="void-path-also">also</span>
                      <ResourceList resources={plan.outputs} label="Also makes" />
                    </>
                  )}
                </p>
              )}
              <details class="void-path-results">
                <summary>
                  Show {plan.recipes.length} {plan.recipes.length === 1 ? 'recipe' : 'recipes'}
                </summary>
                <p class="void-path-score-factors">
                  Inputs ({formatScoreFactor(scoreFactors.inputs)}) + outputs (
                  {formatScoreFactor(scoreFactors.outputs)}) + buildings (
                  {formatScoreFactor(scoreFactors.buildings)}) + certainty (
                  {formatScoreFactor(scoreFactors.certainty)}) = {formatScoreFactor(score)}
                </p>
                <ol
                  class="void-path-steps"
                  aria-label={
                    kind === 'chain' && isResourceChain(plan)
                      ? `Path from ${resource} to ${plan.target}`
                      : kind === 'input' && isResourceChain(plan)
                        ? `Recipe which makes ${resource}`
                        : kind === 'output'
                          ? `Recipe which uses ${resource}`
                          : `Void path for ${resource}`
                  }
                >
                  {plan.recipes.map((id, step) => {
                    const recipe = staticData.recipes[id];
                    if (!recipe) return <li key={`${id}-${step}`}>{recipeName(id)}</li>;
                    return (
                      <li key={`${id}-${step}`}>
                        <CompactRecipe
                          match={{ id, recipe, name: recipeName(id) }}
                          progress={progress}
                        />
                      </li>
                    );
                  })}
                </ol>
              </details>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

function formatScoreFactor(score: number): string {
  return `${score >= 0 ? '+' : ''}${score.toFixed(1)}`;
}

/** A compact, icon-only flow list, matching the folded recipe summaries. */
function ResourceList({ resources, label }: { resources: ResourceId[]; label: string }) {
  return (
    <span
      class="void-path-resource-list"
      aria-label={`${label}: ${resources.map(resourceName).join(', ')}`}
    >
      {resources.map((id, index) => (
        <Fragment key={id}>
          {index === 0 ? null : <span class="void-path-resource-separator">+</span>}
          <span class="void-path-resource" title={resourceName(id)}>
            <ResourceIcon id={id} />
          </span>
        </Fragment>
      ))}
    </span>
  );
}
