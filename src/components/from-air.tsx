import './from-air.css';
import { recipeName, resourceName, staticData } from '../data/index.ts';
import { productAmount } from '../flow.ts';
import type { State } from '../ts.ts';
import type { Recipe, ResourceId, StaticData } from '../types.ts';
import type { UrlState } from '../url-handler.tsx';
import { recipeIconStyle } from './icon.tsx';
import { ResourceIcon } from './resource.tsx';

export interface FromAirRecipe {
  id: string;
  recipe: Recipe;
  /** Products which become available for the first time in this stage. */
  adds: ResourceId[];
  /** A circulating resource needed only to start a productive cycle. */
  assumedInputs?: ResourceId[];
  /** The real recipes represented by a from-air-only aggregate recipe. */
  recipes?: string[];
}

export type FromAirStage = FromAirRecipe[];

/** Mining assumes a resource patch. Other synthetic processes describe actual transformations. */
function usableFromAirRecipe(id: string, recipe: Recipe, infiniteMining: boolean): boolean {
  if (!(recipe.synthetic && id.startsWith('synthetic:mining-'))) return true;
  return infiniteMining && id.startsWith('synthetic:mining-infinite-');
}

type RecipeEntry = [string, Recipe];

function addAmount(amounts: Map<ResourceId, number>, resource: ResourceId, amount: number) {
  amounts.set(resource, (amounts.get(resource) ?? 0) + amount);
}

/** Resources are only useful to this planner when another recipe can consume them. */
function usefulProducts(
  entries: RecipeEntry[],
  allowed: Set<ResourceId>,
  inputRecipeIds: Map<ResourceId, Set<string>>,
): ResourceId[] {
  const products = new Set<ResourceId>();
  for (const [id, recipe] of entries) {
    for (const { resource } of recipe.products) {
      const consumers = inputRecipeIds.get(resource);
      if ([...(consumers ?? [])].some((consumerId) => consumerId !== id) && !allowed.has(resource))
        products.add(resource);
    }
  }
  return [...products];
}

/** Minimal one- and two-recipe cycles through resources which have not been unlocked yet. */
function recipeComponents(entries: RecipeEntry[], allowed: Set<ResourceId>): RecipeEntry[][] {
  const components: RecipeEntry[][] = [];
  const blockedInputs = entries.map(
    ([, recipe]) =>
      new Set(
        recipe.ingredients
          .filter(({ resource }) => !allowed.has(resource))
          .map(({ resource }) => resource),
      ),
  );
  const outputs = entries.map(
    ([, recipe]) => new Set(recipe.products.map(({ resource }) => resource)),
  );
  for (let left = 0; left < entries.length; left++) {
    if ([...blockedInputs[left]].some((resource) => outputs[left].has(resource)))
      components.push([entries[left]]);
    for (let right = left + 1; right < entries.length; right++) {
      if (
        [...blockedInputs[left]].some((resource) => outputs[right].has(resource)) &&
        [...blockedInputs[right]].some((resource) => outputs[left].has(resource))
      )
        components.push([entries[left], entries[right]]);
    }
  }
  return components;
}

function productiveCycle(
  component: RecipeEntry[],
  allowed: Set<ResourceId>,
): FromAirRecipe | undefined {
  const products = new Map<ResourceId, number>();
  const ingredients = new Map<ResourceId, number>();
  for (const [, recipe] of component) {
    for (const ingredient of recipe.ingredients)
      addAmount(ingredients, ingredient.resource, ingredient.amount);
    for (const product of recipe.products)
      addAmount(products, product.resource, productAmount(product, 1));
  }
  const internalResources = [...ingredients.keys()].filter((resource) => !allowed.has(resource));
  if (
    internalResources.length === 0 ||
    internalResources.some(
      (resource) => (products.get(resource) ?? 0) < ingredients.get(resource)!,
    ) ||
    !internalResources.some((resource) => products.get(resource)! > ingredients.get(resource)!)
  )
    return undefined;

  // Prefer the catalyst-like resource with the smallest relative surplus. Starting with it must
  // make every recipe runnable after repeatedly adding the products of runnable recipes.
  const assumedInput = internalResources
    .filter((candidate) => {
      const available = new Set([...allowed, candidate]);
      const pending = [...component];
      while (true) {
        const runnable = pending.filter(([, recipe]) =>
          recipe.ingredients.every(({ resource }) => available.has(resource)),
        );
        if (runnable.length === 0) break;
        for (const entry of runnable) {
          pending.splice(pending.indexOf(entry), 1);
          for (const { resource } of entry[1].products) available.add(resource);
        }
      }
      return pending.length === 0;
    })
    .sort(
      (a, b) =>
        (products.get(a)! - ingredients.get(a)!) / ingredients.get(a)! -
        (products.get(b)! - ingredients.get(b)!) / ingredients.get(b)!,
    )[0];
  if (!assumedInput) return undefined;

  const ids = component.map(([id]) => id);
  const aggregateIngredients = [...ingredients]
    .filter(([resource]) => resource !== assumedInput)
    .map(([resource, amount]) => ({ resource, amount }));
  const aggregateProducts = [...products].map(([resource, amount]) => ({
    resource,
    amount: { fixed: amount } as const,
    probability: 1,
  }));
  return {
    id: `from-air:cycle:${ids.join('+')}`,
    recipe: {
      human: ids.map(recipeName).join(' + '),
      ingredients: aggregateIngredients,
      products: aggregateProducts,
      duration: 1,
      categories: [...new Set(component.flatMap(([, recipe]) => recipe.categories))],
      synthetic: true,
    },
    adds: [],
    assumedInputs: [assumedInput],
    recipes: ids,
  };
}

/** Build the recipe closure one layer at a time. */
export function fromAirStages(
  data: Pick<StaticData, 'recipes'>,
  infiniteMining = false,
): FromAirStage[] {
  const allowed = new Set<ResourceId>();
  const remaining = Object.entries(data.recipes).filter(([id, recipe]) =>
    usableFromAirRecipe(id, recipe, infiniteMining),
  );
  const inputRecipeIds = new Map<ResourceId, Set<string>>();
  for (const [id, recipe] of Object.entries(data.recipes)) {
    for (const { resource } of recipe.ingredients) {
      const ids = inputRecipeIds.get(resource) ?? new Set<string>();
      ids.add(id);
      inputRecipeIds.set(resource, ids);
    }
  }
  const stages: FromAirStage[] = [];

  while (true) {
    // Ingredients unlocked here are deliberately unavailable until the next stage.
    const ordinary: FromAirRecipe[] = remaining
      .filter(([, recipe]) => recipe.ingredients.every(({ resource }) => allowed.has(resource)))
      .map((entry) => ({
        id: entry[0],
        recipe: entry[1],
        adds: usefulProducts([entry], allowed, inputRecipeIds),
      }))
      .filter(({ adds }) => adds.length > 0);
    const cycles = recipeComponents(remaining, allowed)
      .map((component) => {
        const cycle = productiveCycle(component, allowed);
        return cycle && { ...cycle, adds: usefulProducts(component, allowed, inputRecipeIds) };
      })
      .filter((cycle): cycle is FromAirRecipe => cycle !== undefined)
      .filter(({ adds }) => adds.length > 0);
    const stage = [...ordinary, ...cycles];

    if (stage.length === 0) return stages;
    stages.push(stage);
    for (const { adds } of stage) for (const resource of adds) allowed.add(resource);

    const used = new Set(stage.flatMap(({ id, recipes }) => recipes ?? [id]));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (used.has(remaining[i][0])) remaining.splice(i, 1);
    }
  }
}

/** The dedicated planner for production chains that begin with air. */
export function FromAir({ mode: [mode, setMode] }: { mode: State<UrlState['fa']> }) {
  const infiniteMining = mode === 'infinite-mining';
  const stages = fromAirStages(staticData, infiniteMining);

  return (
    <section class="from-air" aria-labelledby="from-air-title">
      <h2 id="from-air-title">From air</h2>
      <p class="from-air-intro">
        Resources available at each step, starting with recipes that need no ingredients. Finite
        mining is excluded; pumping and other synthetic transformations are included.
      </p>
      <label class="from-air-option">
        <input
          type="checkbox"
          checked={infiniteMining}
          onChange={(event) => setMode(event.currentTarget.checked ? 'infinite-mining' : true)}
        />
        Allow infinite mining recipes
      </label>
      <ol class="from-air-stages">
        {stages.map((stage, index) => (
          <li class="from-air-stage" key={index}>
            <h3>Stage {index + 1}</h3>
            <ul class="from-air-recipes">
              {stage.map(({ id, recipe, adds, assumedInputs }) => (
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
                    {assumedInputs?.length ? (
                      <span class="from-air-assumes">
                        assumes{' '}
                        {assumedInputs.map((resource) => (
                          <span class="from-air-resource" title={resource} key={resource}>
                            <ResourceIcon id={resource} />
                            {resourceName(resource)}
                          </span>
                        ))}
                      </span>
                    ) : null}
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
