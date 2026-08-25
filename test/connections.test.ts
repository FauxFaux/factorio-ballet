import { describe, expect, it } from 'vitest';
import type { Solution } from '../src/solve.ts';
import { recipeConnections } from '../src/components/cell/connection-calc.ts';

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
});
