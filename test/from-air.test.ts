import { describe, expect, it } from 'vitest';
import { fromAirStages } from '../src/components/from-air.tsx';
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

  it('lists all products newly added by a recipe only once', () => {
    const air = 'fluid:air';
    const stages = fromAirStages({
      recipes: {
        separate: recipe([], [air, air, 'fluid:nitrogen']),
      },
    });
    expect(stages[0][0].adds).toEqual([air, 'fluid:nitrogen']);
  });
});
