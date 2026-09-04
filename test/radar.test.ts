import { describe, expect, it } from 'vitest';
import {
  assemblerColumnLayout,
  stackAssemblerDistricts,
  type AssemblerDistrict,
} from '../src/components/cell/radar-layout.ts';
import type { Recipe, ResourceId } from '../src/types.ts';

describe('assemblerColumnLayout', () => {
  it('wraps assemblers that exceed the radar height into another column', () => {
    const layout = assemblerColumnLayout(3, 3, 34);

    expect(layout.assemblers).toHaveLength(34);
    expect(layout.assemblers[32]).toEqual({ column: 0, row: 32 });
    expect(layout.assemblers[33]).toEqual({ column: 1, row: 0 });
    expect(layout.height).toBe(99);
    expect(layout.width).toBe(10);
  });

  it('keeps a fitting stack in one column', () => {
    const layout = assemblerColumnLayout(3, 3, 33);

    expect(layout.assemblers[32]).toEqual({ column: 0, row: 32 });
    expect(layout.width).toBe(3);
  });
});

function recipe(ingredients: ResourceId[], products: ResourceId[]): Recipe {
  return {
    ingredients: ingredients.map((resource) => ({ resource, amount: 1 })),
    products: products.map((resource) => ({ resource, amount: { fixed: 1 }, probability: 1 })),
    duration: 1,
    categories: [],
  };
}

function district(recipeData: Recipe): AssemblerDistrict {
  return {
    id: 'test',
    recipeId: 'test',
    recipeName: 'Test',
    recipe: recipeData,
    machineWidth: 3,
    machineHeight: 3,
    count: 1,
  };
}

describe('stackAssemblerDistricts', () => {
  it('stacks adjacent districts joined by an exclusive hand-off', () => {
    const plate = recipe(['item:ore'], ['item:plate']);
    const gear = recipe(['item:plate'], ['item:gear']);

    const stacks = stackAssemblerDistricts([district(plate), district(gear)]);

    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ width: 3, height: 6 });
    expect(stacks[0]?.districts.map(({ y }) => y)).toEqual([0, 3]);
  });

  it('does not stack when the hand-off has another producer or consumer', () => {
    const plate = recipe(['item:ore'], ['item:plate']);
    const recycledPlate = recipe(['item:scrap'], ['item:plate']);
    const gear = recipe(['item:plate'], ['item:gear']);

    expect(
      stackAssemblerDistricts([district(plate), district(gear), district(recycledPlate)]),
    ).toHaveLength(3);
    expect(
      stackAssemblerDistricts([
        district(plate),
        district(gear),
        district(recipe(['item:plate'], ['item:rod'])),
      ]),
    ).toHaveLength(3);
  });
});
