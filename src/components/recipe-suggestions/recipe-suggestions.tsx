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
  kind: 'chain' | 'void';
  plan: ResourceChain | VoidPlan;
  score: number;
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
} as const;

// Recipe data is loaded once and immutable. Index it and retain each completed path search instead
// of redoing a full recipe-data pass whenever the current cell changes.
const staticVoidPlans = voidPlanFinder(staticData);
const staticResourceChains = resourceChainFinder(staticData);

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
 * Rank a path by the boundary flows it adds to a cell. Closed void paths have no extra boundary
 * flows, while chains are rewarded for joining edges the cell already has.
 */
export function scoreRecipeSuggestion(
  plan: ResourceChain | VoidPlan,
  existingInputs: ReadonlySet<ResourceId>,
  existingOutputs: ReadonlySet<ResourceId>,
): number {
  const inputs = isResourceChain(plan) ? plan.inputs : [];
  const outputs = isResourceChain(plan) ? plan.outputs : [];
  const reusedInputs = inputs.filter((resource) => existingInputs.has(resource)).length;
  const reusedOutputs = outputs.filter((resource) => existingOutputs.has(resource)).length;
  const suppliesInput = isResourceChain(plan) && existingInputs.has(plan.target);
  const inputComplexity = inputs.reduce(
    (total, resource) => total + (staticData.resources[resource]?.complexity ?? 1),
    0,
  );

  return (
    -plan.recipes.length * suggestionScoreWeights.step -
    outputs.filter((resource) => !isSingleStepVoidable(resource)).length *
      suggestionScoreWeights.output -
    inputComplexity * suggestionScoreWeights.inputComplexity +
    reusedInputs * suggestionScoreWeights.reusedInput +
    reusedOutputs * suggestionScoreWeights.reusedOutput +
    (suppliesInput ? suggestionScoreWeights.suppliedInput : 0)
  );
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
  const chains = suggestedResourceChains(cell);

  return suggestedVoidResources(search, cell, resource)
    .flatMap((id) => {
      const plans = staticVoidPlans(id, CANDIDATES_PER_RESOURCE);
      const resourceChains = chains.get(id) ?? [];
      if (
        !searched.has(id) &&
        id !== resource &&
        plans.length === 0 &&
        resourceChains.length === 0
      ) {
        return [];
      }
      return [
        ...plans.map((plan) => ({
          resource: id,
          kind: 'void' as const,
          plan,
          score: scoreRecipeSuggestion(plan, existingInputs, existingOutputs),
        })),
        ...resourceChains.map((plan) => ({
          resource: id,
          kind: 'chain' as const,
          plan,
          score: scoreRecipeSuggestion(plan, existingInputs, existingOutputs),
        })),
      ];
    })
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
        suggestions.map(({ resource, kind, plan, score }) => (
          <article key={`${resource}:${kind}:${plan.recipes.join('|')}`} class="void-path-tile">
            <div class="recipe-card void-path-card">
              <div class="void-path-card-head">
                <h3 class="void-path-for">
                  <ResourceIcon id={resource} /> {resourceName(resource)}
                </h3>
                <p class="void-path-score">Score {score.toFixed(1)}</p>
              </div>
              {kind === 'chain' && isResourceChain(plan) && (
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
                <ol
                  class="void-path-steps"
                  aria-label={
                    kind === 'chain' && isResourceChain(plan)
                      ? `Path from ${resource} to ${plan.target}`
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
