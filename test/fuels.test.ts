import { describe, expect, it } from 'vitest';
import { cellInterface, scopeOf, type Cell } from '../src/cell.ts';
import { fueledRecipe } from '../src/compute/fuel.ts';
import { directionalRates, netRates } from '../src/compute/flow.ts';
import { chosenFuel, defaultFuel } from '../src/data/fuels.ts';
import { noChoice, resolveChosen } from '../src/data/index.ts';
import { moduleEffects, laidOutEffects, NO_EFFECTS } from '../src/data/module-effects.ts';
import { searchMatches, searchRecipes } from '../src/data/search.ts';
import { createDataset } from '../src/dataset/index.ts';
import { solveCell } from '../src/solve/index.ts';
import { suggestedRecipePaths } from '../src/components/recipe-suggestions/suggestions.ts';
import type { Machine, Recipe, StaticData } from '../src/types.ts';
import { defaultDataset } from './with-bobang.ts';

const smelt: Recipe = {
  ingredients: [{ resource: 'item:ore', amount: 2 }],
  products: [{ resource: 'item:plate', amount: { fixed: 1 }, probability: 1 }],
  duration: 10,
  categories: ['test-smelt'],
  allowProductivity: true,
};
const burner: Machine = {
  kind: 'furnace',
  item: 'burner',
  categories: ['test-smelt'],
  speed: 2,
  size: { width: 3, height: 3 },
  moduleSlots: 2,
  burner: { power: 2, effectivity: 0.5, fuelCategories: ['chemical'] },
};
const electric: Machine = { ...burner, item: 'electric', burner: undefined, speed: 4 };
const data: StaticData = {
  ...defaultDataset.data,
  recipes: {
    smelt,
    coke: {
      ingredients: [{ resource: 'item:coal', amount: 1 }],
      products: [{ resource: 'item:angels-solid-coke', amount: { fixed: 4 }, probability: 1 }],
      duration: 1,
      categories: ['test-coke'],
    },
  },
  machines: {
    burner,
    electric,
    producer: { ...electric, categories: ['test-coke'], speed: 1 },
  },
  resources: {
    ...defaultDataset.data.resources,
    'item:burner': { complexity: 0 },
    'item:electric': { complexity: 1 },
    'item:ore': {},
    'item:plate': {},
    'item:angels-solid-coke': { fuelValue: 4, fuelCategory: 'chemical' },
    'item:coal': { fuelValue: 2, fuelCategory: 'chemical' },
  },
  modules: {
    speed: { category: 'speed', tier: 1, speed: 0.5, consumption: 0.5 },
    efficiency: { category: 'efficiency', tier: 1, consumption: -0.6 },
    productivity: { category: 'productivity', tier: 1, productivity: 0.5, consumption: 0.4 },
  },
};
const ds = createDataset('fuel-test', { staticData: data, iconMap: {} });
const chosen = noChoice(ds);
const fuel = chosen.fuel;
const cell: Cell = { entries: [{ recipe: 'smelt', machine: 'burner', count: 3 }] };
const context = { ds, progress: 0, chosen };

describe('fuel choices', () => {
  it('defaults to solid coke when available and coal in a pack without it', () => {
    expect(defaultFuel(defaultDataset.data)?.id).toBe('item:angels-solid-coke');
    const { 'item:angels-solid-coke': _coke, ...resources } = data.resources;
    expect(defaultFuel({ ...data, resources })?.id).toBe('item:coal');
    expect(defaultFuel({ ...data, resources: {} })).toBeUndefined();
  });

  it('resolves the stored fuel choice with the other global choices', () => {
    expect(resolveChosen(ds, {}, undefined, undefined, 0).fuel).toEqual(fuel);
    expect(resolveChosen(ds, {}, undefined, undefined, 0, 'item:coal').fuel?.id).toBe('item:coal');
    expect(chosenFuel(data, 'item:missing')).toBeUndefined();
    expect(chosenFuel(data, 'item:plate')).toBeUndefined();
  });
});

describe('fueledRecipe', () => {
  it('converts power, efficiency and fuel value to item use per craft without mutating data', () => {
    const fueled = fueledRecipe(smelt, burner, fuel);
    expect(fueled.ingredients.at(-1)).toEqual({ resource: 'item:angels-solid-coke', amount: 5 });
    expect(
      directionalRates(fueled, burner.speed, NO_EFFECTS).inputs.get('item:angels-solid-coke'),
    ).toBe(1);
    expect(smelt.ingredients).toEqual([{ resource: 'item:ore', amount: 2 }]);
    expect(fueledRecipe(smelt, electric, fuel)).toBe(smelt);
    expect(fueledRecipe(smelt, undefined, fuel)).toBe(smelt);
    expect(fueledRecipe(smelt, burner, undefined)).toBe(smelt);
  });

  it('adds fuel to an existing recipe ingredient', () => {
    const recipe = {
      ...smelt,
      ingredients: [{ resource: 'item:angels-solid-coke' as const, amount: 2 }],
    };
    expect(fueledRecipe(recipe, burner, fuel).ingredients).toEqual([
      { resource: 'item:angels-solid-coke', amount: 7 },
    ]);
  });

  it('does not feed chemical fuel to a burner needing a different category', () => {
    const nuclear = { ...burner, burner: { ...burner.burner!, fuelCategories: ['nuclear'] } };
    expect(fueledRecipe(smelt, nuclear, fuel)).toBe(smelt);
  });

  it('changes fuel per craft with speed and fuel per second with energy consumption', () => {
    const effects = moduleEffects(data, burner, { speed: 2 }, smelt);
    expect(effects).toEqual({ speed: 2, productivity: 1, consumption: 2 });
    const rates = netRates(fueledRecipe(smelt, burner, fuel, effects), burner.speed, effects);
    expect(rates.get('item:angels-solid-coke')).toBe(-2);
    expect(rates.get('item:ore')).toBe(-0.8);
    const faster = { ...effects, consumption: 1 };
    expect(
      netRates(fueledRecipe(smelt, burner, fuel, faster), burner.speed, faster).get(
        'item:angels-solid-coke',
      ),
    ).toBe(-1);
  });

  it('includes burnt results without paying productivity on them', () => {
    const ashFuel = { ...fuel!, resource: { ...fuel!.resource, burntResult: 'item:ash' as const } };
    const effects = { ...NO_EFFECTS, productivity: 2 };
    const rates = netRates(fueledRecipe(smelt, burner, ashFuel, effects), burner.speed, effects);
    expect(rates.get('item:ash')).toBe(1);
    expect(rates.get('item:plate')).toBe(0.4);
  });
});

describe('burner energy effects', () => {
  it('floors efficiency at 20 percent and obeys allowed effects', () => {
    expect(moduleEffects(data, burner, { efficiency: 2 }, smelt).consumption).toBe(0.2);
    expect(
      moduleEffects(data, { ...burner, allowedEffects: ['speed'] }, { speed: 2 }, smelt)
        .consumption,
    ).toBe(1);
  });

  it('counts transmitted beacon energy effects only when the beacon allows them', () => {
    const beacon = { moduleSlots: 2, distributionEffectivity: 1.5 };
    const run = (allowedEffects: typeof burner.allowedEffects) =>
      laidOutEffects(
        ds,
        burner,
        undefined,
        smelt,
        { speed: 'speed' },
        { productivity: 0, speed: 0, beacons: 1 },
        { ...beacon, allowedEffects },
      ).effects;
    expect(run(['speed', 'consumption'])).toEqual({
      speed: 2.5,
      productivity: 1,
      consumption: 2.5,
    });
    expect(run(['speed'])).toEqual({ speed: 2.5, productivity: 1, consumption: 1 });
  });
});

describe('fuel in cells and search', () => {
  it('exposes fuel as an input and scales consumption by the pinned machine count', () => {
    const iface = cellInterface(data, cell, context);
    expect(iface.inputs).toContain('item:angels-solid-coke');
    expect(iface.inPlay).toContain('item:angels-solid-coke');
    const solved = solveCell(ds, data, cell, 0, chosen);
    expect(solved.inputRates[0].get('item:angels-solid-coke')).toBe(1);
    expect(solved.balance.get('item:angels-solid-coke')).toBe(-3);
    const electricCell = { entries: [{ ...cell.entries[0], machine: 'electric' }] };
    expect(cellInterface(data, electricCell, context).inputs).not.toContain(
      'item:angels-solid-coke',
    );
    expect(solveCell(ds, data, electricCell, 0, chosen).balance.has('item:angels-solid-coke')).toBe(
      false,
    );
  });

  it('balances a fuel producer and exposes internal fuel once', () => {
    const supplied = { entries: [...cell.entries, { recipe: 'coke' }] };
    const solved = solveCell(ds, data, supplied, 0, chosen);
    expect(solved.complete).toBe(true);
    expect(solved.counts).toEqual([3, 0.75]);
    expect(solved.balance.get('item:angels-solid-coke')).toBe(0);
    const iface = cellInterface(data, supplied, context);
    expect(iface.inputs).not.toContain('item:angels-solid-coke');
    expect(iface.inPlay.filter((id) => id === 'item:angels-solid-coke')).toHaveLength(1);
  });

  it('matches fuel use for the default building and updates when progress selects electricity', () => {
    const search = { ds, chosen };
    expect(
      searchRecipes(data, 'uses:item:angels-solid-coke', 0, undefined, search).map(({ id }) => id),
    ).toContain('smelt');
    expect(searchRecipes(data, 'uses:item:angels-solid-coke', 1, undefined, search)).toEqual([]);
    expect(
      searchMatches(data, 'uses:item:coal', 0, undefined, {
        ds,
        chosen: { ...chosen, fuel: chosenFuel(data, 'item:coal') },
      }).some((match) => match.match.id === 'smelt'),
    ).toBe(true);
  });

  it('finds fuel supply through cell scopes and suggestions', () => {
    const scope = scopeOf(cellInterface(data, cell, context));
    expect(
      searchRecipes(data, 'makes:@in', 0, scope, { ds, chosen }).map(({ id }) => id),
    ).toContain('coke');
    expect(
      suggestedRecipePaths(data, ds.suggestionPlans, '', cell, undefined, context).some(
        (suggestion) =>
          suggestion.resource === 'item:angels-solid-coke' &&
          suggestion.plan.recipes.includes('coke'),
      ),
    ).toBe(true);
  });

  it('accounts for the ingested blast furnace fuel power', () => {
    const machine = defaultDataset.data.machines['angels-blast-furnace'];
    const [recipeId, recipe] = Object.entries(defaultDataset.data.recipes).find(
      ([, recipe]) =>
        recipe.categories.includes('angels-blast-smelting') &&
        !recipe.ingredients.some(({ resource }) => resource === 'item:angels-solid-coke'),
    )!;
    const result = solveCell(
      defaultDataset,
      defaultDataset.data,
      { entries: [{ recipe: recipeId, machine: 'angels-blast-furnace', count: 1 }] },
      0,
      noChoice(defaultDataset),
    );
    expect(result.inputRates[0].get('item:angels-solid-coke')).toBeCloseTo(0.06);
    expect(
      fueledRecipe(recipe, machine, noChoice(defaultDataset).fuel).ingredients.at(-1)?.resource,
    ).toBe('item:angels-solid-coke');
  });
});
