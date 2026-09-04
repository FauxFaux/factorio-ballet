import { describe, expect, it } from 'vitest';
import type { Solution } from '../src/solve/index.ts';
import {
  recipeConnections,
  simplifiedMachineRatio,
} from '../src/components/cell/connection-calc.ts';

describe('recipeConnections', () => {
  it('shows every rate, including an output no other row consumes', () => {
    const solution: Solution = {
      counts: [2],
      rates: [
        new Map([
          ['item:ore', -3],
          ['fluid:water', -1],
          ['item:plate', 4],
          ['item:byproduct', 0.5],
          ['item:noise', 1e-10],
        ]),
      ],
      inputRates: [
        new Map([
          ['item:ore', 3],
          ['fluid:water', 1],
        ]),
      ],
      outputRates: [
        new Map([
          ['item:plate', 4],
          ['item:byproduct', 0.5],
          ['item:noise', 1e-10],
        ]),
      ],
      balance: new Map(),
      complete: true,
      notes: [],
    };

    expect(recipeConnections(0, solution)).toEqual({
      inputs: [
        { resource: 'item:ore', rate: 6 },
        { resource: 'fluid:water', rate: 2 },
      ],
      outputs: [
        { resource: 'item:plate', rate: 8 },
        { resource: 'item:byproduct', rate: 1 },
      ],
    });
  });

  it('shows a returned tool as both a gross input and output', () => {
    const solution: Solution = {
      counts: [2],
      rates: [new Map([['item:saw', -0.05]])],
      inputRates: [new Map([['item:saw', 0.5]])],
      outputRates: [new Map([['item:saw', 0.45]])],
      balance: new Map(),
      complete: true,
      notes: [],
    };

    expect(recipeConnections(0, solution)).toEqual({
      inputs: [{ resource: 'item:saw', rate: 1 }],
      outputs: [{ resource: 'item:saw', rate: 0.9 }],
    });
  });

  it('shows counterpart machines relative to this recipe for in-cell flows', () => {
    const solution: Solution = {
      counts: [1, 2],
      rates: [new Map([['item:plate', -2]]), new Map([['item:plate', 1]])],
      inputRates: [new Map([['item:plate', 2]]), new Map()],
      outputRates: [new Map(), new Map([['item:plate', 1]])],
      balance: new Map(),
      complete: true,
      notes: [],
    };

    expect(recipeConnections(0, solution, ['make-furnace', 'make-plate'])).toEqual({
      inputs: [
        {
          resource: 'item:plate',
          rate: 2,
          connectedMachineCount: 2,
          machineCount: 1,
          connectedRecipes: ['make-plate'],
        },
      ],
      outputs: [],
    });
  });
});

describe('simplifiedMachineRatio', () => {
  it('scales the smaller side to one and rounds the other to one decimal place', () => {
    expect(simplifiedMachineRatio(1.7, 1)).toBe('1.7:1');
    expect(simplifiedMachineRatio(1, 2.54)).toBe('1:2.5');
  });
});
