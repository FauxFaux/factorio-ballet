import './void-path.css';
import { useMemo } from 'preact/hooks';
import { recipeName, resourceName, staticData } from '../data/index.ts';
import type { ResourceId } from '../types.ts';
import { voidPlans } from '../void-path.ts';
import { ResourceIcon } from './resource.tsx';

export function VoidPath({ resource }: { resource?: ResourceId }) {
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
                <span class="void-path-rank">{plan.recipes.length} recipes</span>
                <ol class="void-path-steps" aria-label={`Void path ${index + 1}`}>
                  {plan.recipes.map((id) => (
                    <li key={id} title={id}>
                      {recipeName(id)}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
