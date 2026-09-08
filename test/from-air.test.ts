import { describe, expect, it } from 'vitest';
import { fromAirStages } from '../src/components/from-air.tsx';
import { staticData } from '../src/data/index.ts';
import type { Recipe, ResourceId } from '../src/types.ts';

const recipe = (ingredients: ResourceId[], products: ResourceId[], synthetic = false): Recipe => ({
  ingredients: ingredients.map((resource) => ({ resource, amount: 1 })),
  products: products.map((resource) => ({ resource, amount: { fixed: 1 }, probability: 1 })),
  duration: 1,
  categories: ['crafting'],
  synthetic: synthetic || undefined,
});

describe('fromAirStages', () => {
  it('unlocks recipes in discrete stages until no new resource can be made', () => {
    const air = 'fluid:air';
    const oxygen = 'fluid:oxygen';
    const plate = 'item:plate';
    const unreachable = 'item:unreachable';
    const stages = fromAirStages({
      recipes: {
        compress: recipe([], [air]),
        separate: recipe([air], [oxygen]),
        smelt: recipe([oxygen], [plate]),
        blocked: recipe([unreachable], ['item:never']),
      },
    });
    expect(stages.map((stage) => stage.map(({ id }) => id))).toEqual([
      ['compress'],
      ['separate'],
      ['smelt'],
    ]);
  });

  it('includes pumping and excludes every synthetic mining recipe', () => {
    const water = 'fluid:water';
    const stages = fromAirStages({
      recipes: {
        'synthetic:pumping-water': recipe([], [water], true),
        'synthetic:mining-ore': recipe([], ['item:ore'], true),
        wash: recipe([water], ['item:washed']),
      },
    });
    expect(stages.flat().map(({ id }) => id)).toEqual(['synthetic:pumping-water', 'wash']);
  });

  it('optionally unlocks infinite mining after its fluid input, but not finite mining', () => {
    const water = 'fluid:water';
    const stages = fromAirStages(
      {
        recipes: {
          'synthetic:pumping-water': recipe([], [water], true),
          'synthetic:mining-coal': recipe([], ['item:finite-coal'], true),
          'synthetic:mining-infinite-coal': recipe([water], ['item:coal'], true),
        },
      },
      true,
    );

    expect(stages.map((stage) => stage.map(({ id }) => id))).toEqual([
      ['synthetic:pumping-water'],
      ['synthetic:mining-infinite-coal'],
    ]);
  });

  it('lists all products newly added by a recipe only once', () => {
    const air = 'fluid:air';
    const stages = fromAirStages({
      recipes: {
        separate: recipe([], [air, air, 'fluid:nitrogen']),
      },
    });
    expect(stages[0][0].adds).toEqual([air, 'fluid:nitrogen']);
  });

  it('bootstraps a productive cycle with its circulating resource as an assumed input', () => {
    const seed = 'item:seed';
    const plant = 'item:plant';
    const water = 'fluid:water';
    const stages = fromAirStages({
      recipes: {
        pump: recipe([], [water]),
        grow: {
          ...recipe([seed, water], [plant]),
          ingredients: [
            { resource: seed, amount: 5 },
            { resource: water, amount: 10 },
          ],
          products: [{ resource: plant, amount: { fixed: 45 }, probability: 1 }],
        },
        extract: {
          ...recipe([plant], [seed]),
          ingredients: [{ resource: plant, amount: 5 }],
          products: [{ resource: seed, amount: { fixed: 5.5 }, probability: 1 }],
        },
      },
    });

    const cycle = stages[1][0];
    expect(cycle.recipes).toEqual(['grow', 'extract']);
    expect(cycle.assumedInputs).toEqual([seed]);
    expect(cycle.recipe.ingredients).toEqual([
      { resource: water, amount: 10 },
      { resource: plant, amount: 5 },
    ]);
    expect(cycle.adds).toEqual([plant, seed]);
  });

  it('does not bootstrap a cycle which consumes its circulating resources', () => {
    const a = 'item:a';
    const b = 'item:b';
    expect(fromAirStages({ recipes: { one: recipe([a], [b]), two: recipe([b], [a]) } })).toEqual(
      [],
    );
  });

  it('finds the productive swamp seed cycles in the application data', () => {
    const cycles = fromAirStages(staticData)
      .flat()
      .filter(({ recipes }) => recipes !== undefined)
      .map(({ recipes }) => recipes);
    for (const tier of [1, 2, 3]) {
      expect(cycles).toContainEqual([`angels-swamp-${tier}`, `angels-swamp-${tier}-seed`]);
    }
  });
});
