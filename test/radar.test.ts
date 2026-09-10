import { describe, expect, it } from 'vitest';
import {
  assemblerColumnLayout,
  beltsPerAssemblerColumn,
  stackAssemblerDistricts,
  type AssemblerDistrict,
} from '../src/components/cell/radar-layout.ts';
import { stackedInputStationStop, stackedRailPath } from '../src/components/cell/radar.tsx';
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

  it('reserves belt space around and between assembler columns', () => {
    const layout = assemblerColumnLayout(3, 3, 34, 7, 3);

    expect(layout.inputBeltsPerColumn).toBe(4);
    expect(layout.outputBeltsPerColumn).toBe(2);
    expect(layout.inputBeltGap).toBe(1);
    expect(layout.outputBeltGap).toBe(1);
    expect(layout.columnGap).toBe(8);
    expect(layout.width).toBe(22);
  });

  it('reserves one cell between each belt bank and a single assembler column', () => {
    const layout = assemblerColumnLayout(3, 3, 1, 2, 1);

    expect(layout.width).toBe(8);
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
    inputItemRate: 0,
    outputItemRate: 0,
  };
}

describe('beltsPerAssemblerColumn', () => {
  it('rounds a district item flow up after spreading it over assembler columns', () => {
    expect(beltsPerAssemblerColumn(91 / 15, 2)).toBe(4);
    expect(beltsPerAssemblerColumn(0, 2)).toBe(0);
  });
});

describe('stackAssemblerDistricts', () => {
  it('stacks adjacent districts joined by an exclusive hand-off', () => {
    const plate = recipe(['item:ore'], ['item:plate']);
    const gear = recipe(['item:plate'], ['item:gear']);

    const stacks = stackAssemblerDistricts([district(plate), district(gear)]);

    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ width: 3, height: 8 });
    expect(stacks[0]?.districts.map(({ y }) => y)).toEqual([0, 5]);
  });

  it('starts a new stack when the two-cell recipe gap would exceed its height', () => {
    const plate = district(recipe(['item:ore'], ['item:plate']));
    const gear = district(recipe(['item:plate'], ['item:gear']));
    plate.count = 17;
    gear.count = 16;

    expect(stackAssemblerDistricts([plate, gear])).toHaveLength(2);
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

describe('stackedRailPath', () => {
  it('omits input trunks and attachments when there are no stations', () => {
    const path = stackedRailPath(0, 0);

    expect(path).not.toContain('M 4 13 c 0 6, 4 7, 4 11 l 0 80');
    expect(path).not.toContain('M 4 20');
    expect(path).not.toContain('M 60 40');
  });

  it('adds input stations from the bottom upwards', () => {
    const path = stackedRailPath(3, 0);

    expect(path).not.toContain('M 4 20');
    expect(path).toContain('M 4 13 c 0 6, 4 7, 4 11 l 0 80');
    expect(path).toContain('M 60 100 l 0 12 c 0 7, 8 11, 16 11');
    expect(path).toContain('M 8 104 c 0 4, 4 8, 8 8 l 36 0 c 8 0, 8 11, 24 11');
    expect(path).not.toContain('l 0 80 c');
    expect(path).toContain('M 8 104');
    expect(path).toContain('M 8 94');
    expect(path).toContain('M 8 84');
    expect(stackedInputStationStop(0)).toEqual({ x: 48, y: 112 });
    expect(stackedInputStationStop(2)).toEqual({ x: 48, y: 92 });
  });

  it('retains the original output-station loops', () => {
    const path = stackedRailPath(1, 1);

    expect(path).toContain('M 188 13 c 0 8, -8 12, -8 20 l 0 60');
  });

  it('blends a lone bottom station directly onto the bottom border', () => {
    const path = stackedRailPath(1, 0);

    expect(path).toContain('M 8 104 c 0 4, 4 8, 8 8 l 36 0 c 8 0, 8 11, 24 11');
    expect(path).not.toContain('M 60');
  });
});
