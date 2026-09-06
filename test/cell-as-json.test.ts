import { describe, expect, it } from 'vitest';
import { cellSolutionJson } from '../src/components/cell/as-json.tsx';
import type { Cell } from '../src/cell.ts';
import type { Solution } from '../src/solve/index.ts';
import type { ResourceId } from '../src/types.ts';

const ore = 'item:iron-ore' as ResourceId;
const plate = 'item:iron-plate' as ResourceId;

describe('cellSolutionJson', () => {
  it("exports edge rates and every recipe row's solved count", () => {
    const cell: Cell = {
      entries: [{ recipe: 'iron-plate', count: 4 }, { recipe: 'iron-gear-wheel' }],
    };
    const solution: Solution = {
      counts: [4, undefined],
      rates: [],
      balance: new Map([
        [ore, -8],
        [plate, 3],
      ]),
      inputRates: [],
      outputRates: [],
      complete: false,
      notes: [],
    };

    expect(
      cellSolutionJson(cell, { inputs: [ore], outputs: [plate], inPlay: [ore, plate] }, solution),
    ).toEqual({
      inputs: [{ material: ore, rate: 8 }],
      recipes: [
        { recipe: 'iron-plate', count: 4, inputs: [], outputs: [] },
        { recipe: 'iron-gear-wheel', count: null, inputs: [], outputs: [] },
      ],
      outputs: [{ material: plate, rate: 3 }],
    });
  });

  it('includes each recipe connection table without transport counts', () => {
    const cell: Cell = {
      entries: [{ recipe: 'make-furnace' }, { recipe: 'make-plate' }],
    };
    const solution: Solution = {
      counts: [1, 2],
      rates: [],
      balance: new Map(),
      inputRates: [new Map([[plate, 2]]), new Map()],
      outputRates: [new Map(), new Map([[plate, 1]])],
      complete: true,
      notes: [],
    };

    expect(cellSolutionJson(cell, { inputs: [], outputs: [], inPlay: [plate] }, solution)).toEqual({
      inputs: [],
      recipes: [
        {
          recipe: 'make-furnace',
          count: 1,
          inputs: [{ material: plate, rate: 2, ratio: 2 }],
          outputs: [],
        },
        {
          recipe: 'make-plate',
          count: 2,
          inputs: [],
          outputs: [{ material: plate, rate: 2, ratio: 0.5 }],
        },
      ],
      outputs: [],
    });
  });
});
