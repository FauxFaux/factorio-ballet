import { describe, expect, it } from 'vitest';
import type { Solution } from '../src/solve/index.ts';
import { internalConnections } from '../src/components/cell/internal-calc.ts';

describe('internalConnections', () => {
  it('pivots solved recipe flows around the resource', () => {
    const solution: Solution = {
      counts: [2, 3],
      rates: [new Map([['item:plate', -2]]), new Map([['item:plate', 1]])],
      inputRates: [new Map([['item:plate', 2]]), new Map()],
      outputRates: [new Map(), new Map([['item:plate', 1]])],
      balance: new Map(),
      complete: true,
      notes: [],
    };

    expect(internalConnections('item:plate', ['smelt-plate', 'make-gear'], solution)).toEqual({
      inputs: [{ recipe: 'smelt-plate', rate: 4 }],
      outputs: [{ recipe: 'make-gear', rate: 3 }],
    });
  });
});
