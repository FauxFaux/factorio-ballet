import './recipe-suggestions.css';
import { useMemo } from 'preact/hooks';
import { recipeName, resourceName, staticData } from '../../data/index.ts';
import type { ResourceId } from '../../types.ts';
import { voidPlans } from '../../void-path.ts';
import { CompactRecipe } from '../compact-recipe.tsx';
import { ResourceIcon } from '../resource.tsx';

export function RecipeSuggestions({
  resource,
  progress,
}: {
  resource?: ResourceId;
  progress: number;
}) {
  const plans = useMemo(() => (resource ? voidPlans(resource, staticData) : []), [resource]);

  return (
    <section class="void-path" aria-label="Void paths">
      <h2>Void paths</h2>
      {!resource ? (
        <p class="void-path-hint">Pick a resource to find ways to void it.</p>
      ) : plans.length === 0 ? (
        <p class="void-path-hint">No short closed void path found for {resourceName(resource)}.</p>
      ) : (
        <>
          <p class="void-path-for">
            <ResourceIcon id={resource} /> {resourceName(resource)}
          </p>
          <ol class="void-path-results">
            {plans.map((plan, index) => (
              <li key={plan.recipes.join('|')} class="void-path-result">
                <ol class="void-path-steps" aria-label={`Void path ${index + 1}`}>
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
        </>
      )}
    </section>
  );
}
