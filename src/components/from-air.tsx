import './from-air.css';
import { recipeName, resourceName, staticData } from '../data/index.ts';
import type { Recipe, ResourceId, StaticData } from '../types.ts';
import { recipeIconStyle } from './icon.tsx';
import { ResourceIcon } from './resource.tsx';

export interface FromAirRecipe {
  id: string;
  recipe: Recipe;
  /** Products which become available for the first time in this stage. */
  adds: ResourceId[];
}

export type FromAirStage = FromAirRecipe[];

/** Mining assumes a resource patch. Other synthetic processes describe actual transformations. */
function usableFromAirRecipe(id: string, recipe: Recipe): boolean {
  return !(recipe.synthetic && id.startsWith('synthetic:mining-'));
}

/** Build the recipe closure one layer at a time. */
export function fromAirStages(data: Pick<StaticData, 'recipes'>): FromAirStage[] {
  const allowed = new Set<ResourceId>();
  const remaining = Object.entries(data.recipes).filter(([id, recipe]) =>
    usableFromAirRecipe(id, recipe),
  );
  const stages: FromAirStage[] = [];

  while (true) {
    // Ingredients unlocked here are deliberately unavailable until the next stage.
    const stage = remaining
      .filter(([, recipe]) => recipe.ingredients.every(({ resource }) => allowed.has(resource)))
      .map(([id, recipe]) => ({
        id,
        recipe,
        adds: [...new Set(recipe.products.map(({ resource }) => resource))].filter(
          (resource) => !allowed.has(resource),
        ),
      }))
      .filter(({ adds }) => adds.length > 0);

    if (stage.length === 0) return stages;
    stages.push(stage);
    for (const { adds } of stage) for (const resource of adds) allowed.add(resource);

    const used = new Set(stage.map(({ id }) => id));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (used.has(remaining[i][0])) remaining.splice(i, 1);
    }
  }
}

/** The dedicated planner for production chains that begin with air. */
export function FromAir() {
  const stages = fromAirStages(staticData);

  return (
    <section class="from-air" aria-labelledby="from-air-title">
      <h2 id="from-air-title">From air</h2>
      <p class="from-air-intro">
        Resources available at each step, starting with recipes that need no ingredients. Mining is
        excluded; pumping and other synthetic transformations are included.
      </p>
      <ol class="from-air-stages">
        {stages.map((stage, index) => (
          <li class="from-air-stage" key={index}>
            <h3>Stage {index + 1}</h3>
            <ul class="from-air-recipes">
              {stage.map(({ id, recipe, adds }) => (
                <li class="from-air-recipe" key={id}>
                  <span
                    class="from-air-recipe-icon"
                    style={recipeIconStyle(id, recipe)}
                    aria-hidden="true"
                  />
                  <span class="from-air-recipe-name" title={id}>
                    {recipeName(id)}
                  </span>
                  <span class="from-air-adds" aria-label="Adds">
                    <span class="from-air-arrow" aria-hidden="true">
                      →
                    </span>
                    {adds.map((resource) => (
                      <span class="from-air-resource" title={resource} key={resource}>
                        <ResourceIcon id={resource} />
                        {resourceName(resource)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
