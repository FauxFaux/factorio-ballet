import { isFluid, isItem, type Product, type Recipe } from '../types.ts';

function productAmount(product: Product): number {
  return 'fixed' in product.amount
    ? product.amount.fixed
    : (product.amount.min + product.amount.max) / 2;
}

/** Whether a recipe probabilistically destroys some of its sole input. */
export function isVoid(recipe: Recipe): boolean {
  if (recipe.ingredients.length !== 1 || recipe.products.length !== 1) return false;

  const ingredient = recipe.ingredients[0];
  const product = recipe.products[0];
  return (
    ingredient.resource === product.resource &&
    ingredient.amount <= productAmount(product) &&
    product.probability < 1
  );
}

/** Whether a recipe puts a fluid into a barrel or canister. */
export function isBarrelling(recipe: Recipe): boolean {
  return (
    recipe.ingredients.some(({ resource }) => isFluid(resource)) &&
    recipe.products.some(({ resource }) => isItem(resource) && resource.endsWith('-barrel'))
  );
}

/** Whether a recipe takes a filled barrel apart into fluid. */
export function isUnbarrelling(recipe: Recipe): boolean {
  return (
    recipe.ingredients.some(({ resource }) => isItem(resource) && resource.endsWith('-barrel')) &&
    recipe.products.some(({ resource }) => isFluid(resource))
  );
}

/** Whether this recipe was synthesized from non-recipe game data during ingestion. */
export function isSynthetic(recipe: Recipe): boolean {
  return recipe.synthetic === true;
}
