import { burnerFuel, type FuelMatch } from '../data/fuels.ts';
import { NO_EFFECTS, type Effects } from '../data/module-effects.ts';
import type { Machine, Recipe } from '../types.ts';

/** Add the selected machine's fuel use per craft without changing the static recipe. */
export function fueledRecipe(
  recipe: Recipe,
  machine: Machine | undefined,
  fuel: FuelMatch | undefined,
  effects: Effects = NO_EFFECTS,
): Recipe {
  const burner = machine?.burner;
  const selected = burnerFuel(machine, fuel);
  const fuelValue = selected?.resource.fuelValue;
  if (!machine || !burner || !selected || !fuelValue) {
    return recipe;
  }
  const amount =
    (burner.power * effects.consumption * recipe.duration) /
    (burner.effectivity * fuelValue * machine.speed * effects.speed);
  if (!(amount > 0) || !Number.isFinite(amount)) return recipe;
  const existing = recipe.ingredients.findIndex(({ resource }) => resource === selected.id);
  const ingredients =
    existing < 0
      ? [...recipe.ingredients, { resource: selected.id, amount }]
      : recipe.ingredients.map((ingredient, index) =>
          index === existing ? { ...ingredient, amount: ingredient.amount + amount } : ingredient,
        );
  const products = selected.resource.burntResult
    ? [
        ...recipe.products,
        {
          resource: selected.resource.burntResult,
          amount: { fixed: amount },
          probability: 1,
          ignoredByProductivity: amount,
        },
      ]
    : recipe.products;
  return { ...recipe, ingredients, products };
}
