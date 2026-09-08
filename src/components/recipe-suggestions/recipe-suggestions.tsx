import './recipe-suggestions.css';
import { useMemo } from 'preact/hooks';
import { cellInterface, scopeOf, type Cell } from '../../cell.ts';
import { recipeName, resourceName, staticData } from '../../data/index.ts';
import type { ResourceId } from '../../types.ts';
import { parseSearch } from '../../search.ts';
import { resourceChainFinder, voidPlanFinder, type ResourceChain } from '../../void-path.ts';
import { CompactRecipe } from '../compact-recipe.tsx';
import { ResourceIcon } from '../resource.tsx';

interface VoidSuggestion {
  resource: ResourceId;
  plans: ReturnType<typeof staticVoidPlans>;
  chains: ResourceChain[];
}

// Recipe data is loaded once and immutable. Index it and retain each completed path search instead
// of redoing a full recipe-data pass whenever the current cell changes.
const staticVoidPlans = voidPlanFinder(staticData);
const staticResourceChains = resourceChainFinder(staticData);

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
export function suggestedResourceChains(cell?: Cell): Map<ResourceId, ResourceChain[]> {
  if (!cell) return new Map();
  const { inputs, outputs } = cellInterface(cell);
  return new Map(
    outputs
      .map((output) => [output, staticResourceChains(output, inputs)] as const)
      .filter(([, chains]) => chains.length > 0),
  );
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
  const suggestions = useMemo<VoidSuggestion[]>(() => {
    const searched = new Set(usedResources(search, cell));
    const chains = suggestedResourceChains(cell);
    return (
      suggestedVoidResources(search, cell, resource)
        .map((resource) => ({
          resource,
          plans: staticVoidPlans(resource),
          chains: chains.get(resource) ?? [],
        }))
        // A `uses:` query should explain that it cannot be voided; output-only suggestions should not
        // take space unless there is a void path or a route to a wanted cell input.
        .filter(
          ({ resource: id, plans, chains }) =>
            searched.has(id) || id === resource || plans.length > 0 || chains.length > 0,
        )
    );
  }, [search, cell, resource]);

  return (
    <section class="void-path" aria-label="Recipe paths">
      <h2>Recipe paths</h2>
      {suggestions.length === 0 ? (
        <p class="void-path-hint">
          Search for recipes using a resource to find ways to void it or feed a cell input.
        </p>
      ) : (
        suggestions.map(({ resource, plans, chains: suggestionChains }) => (
          <article key={resource} class="void-path-tile">
            <h3 class="void-path-for">
              <ResourceIcon id={resource} /> {resourceName(resource)}
            </h3>
            {suggestionChains.length > 0 && (
              <ol class="void-path-results" aria-label={`Paths from ${resourceName(resource)}`}>
                {suggestionChains.map((plan, index) => (
                  <li key={`${plan.target}:${plan.recipes.join('|')}`} class="void-path-result">
                    <p class="void-path-to">
                      Makes <ResourceIcon id={plan.target} /> {resourceName(plan.target)}
                      {plan.inputs.length > 0 && (
                        <span
                          class="void-path-extra-flow void-path-extra-inputs"
                          aria-label={`Additional inputs: ${plan.inputs.map(resourceName).join(', ')}`}
                        >
                          <span class="void-path-extra-label">Needs</span>
                          {plan.inputs.map((id) => (
                            <span key={id} title={resourceName(id)}>
                              <ResourceIcon id={id} />
                            </span>
                          ))}
                        </span>
                      )}
                      {plan.outputs.length > 0 && (
                        <span
                          class="void-path-extra-flow void-path-extra-outputs"
                          aria-label={`Additional outputs: ${plan.outputs.map(resourceName).join(', ')}`}
                        >
                          <span class="void-path-extra-label">Also makes</span>
                          {plan.outputs.map((id) => (
                            <span key={id} title={resourceName(id)}>
                              <ResourceIcon id={id} />
                            </span>
                          ))}
                        </span>
                      )}
                    </p>
                    <ol
                      class="void-path-steps"
                      aria-label={`Path from ${resource} to ${plan.target}, ${index + 1}`}
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
                  </li>
                ))}
              </ol>
            )}
            {plans.length === 0 && suggestionChains.length === 0 ? (
              <p class="void-path-hint">No short closed void path found.</p>
            ) : plans.length > 0 ? (
              <ol class="void-path-results">
                {plans.map((plan, index) => (
                  <li key={plan.recipes.join('|')} class="void-path-result">
                    <ol
                      class="void-path-steps"
                      aria-label={`Void path for ${resource}, ${index + 1}`}
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
                  </li>
                ))}
              </ol>
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}
