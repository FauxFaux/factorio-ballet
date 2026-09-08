import './recipe-suggestions.css';
import { useMemo } from 'preact/hooks';
import { cellInterface, scopeOf, type Cell } from '../../cell.ts';
import { recipeName, resourceName, staticData } from '../../data/index.ts';
import type { ResourceId } from '../../types.ts';
import { parseSearch } from '../../search.ts';
import { voidPlanFinder } from '../../void-path.ts';
import { CompactRecipe } from '../compact-recipe.tsx';
import { ResourceIcon } from '../resource.tsx';

interface VoidSuggestion {
  resource: ResourceId;
  plans: ReturnType<typeof staticVoidPlans>;
}

// Recipe data is loaded once and immutable. Index it and retain each completed path search instead
// of redoing a full recipe-data pass whenever the current cell changes.
const staticVoidPlans = voidPlanFinder(staticData);

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
    return (
      suggestedVoidResources(search, cell, resource)
        .map((resource) => ({ resource, plans: staticVoidPlans(resource) }))
        // A `uses:` query should explain that it cannot be voided; output-only suggestions should not
        // take space unless there is something useful to show.
        .filter(
          ({ resource: id, plans }) => searched.has(id) || id === resource || plans.length > 0,
        )
    );
  }, [search, cell, resource]);

  return (
    <section class="void-path" aria-label="Void paths">
      <h2>Void paths</h2>
      {suggestions.length === 0 ? (
        <p class="void-path-hint">Search for recipes using a resource to find ways to void it.</p>
      ) : (
        suggestions.map(({ resource, plans }) => (
          <article key={resource} class="void-path-tile">
            <h3 class="void-path-for">
              <ResourceIcon id={resource} /> {resourceName(resource)}
            </h3>
            {plans.length === 0 ? (
              <p class="void-path-hint">No short closed void path found.</p>
            ) : (
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
            )}
          </article>
        ))
      )}
    </section>
  );
}
