import { describe, expect, it } from 'vitest';
import { searchModuleFlows } from '../../src/compute/placement-plan/flow-search.ts';
import type { FactoryModule } from '../../src/compute/modules.ts';

function module(id: string, supply: number, demand: number): FactoryModule {
  return {
    id,
    recipe: id,
    machineCount: 1,
    copies: 1,
    size: { width: 1, height: 1 },
    ports: [],
    inputs: { 'item:plate': demand },
    outputs: { 'item:plate': supply },
  };
}

/** Independently enumerate every integer transportation matrix for two suppliers. */
function minimumEdges(supply: number[], demand: number[]): number {
  let best = Infinity;
  const visit = (column: number, remaining: number, edges: number) => {
    if (column === demand.length) {
      if (remaining === 0) best = Math.min(best, edges);
      return;
    }
    for (let first = 0; first <= Math.min(remaining, demand[column]); first++) {
      visit(
        column + 1,
        remaining - first,
        edges + Number(first > 0) + Number(first < demand[column]),
      );
    }
  };
  visit(0, supply[0], 0);
  return best;
}

describe('searchModuleFlows', () => {
  it('matches the minimum-support exhaustive oracle for small balanced networks', () => {
    for (let a = 1; a <= 4; a++)
      for (let b = 1; b <= 4; b++) {
        for (let x = 1; x < a + b - 1; x++)
          for (let y = 1; y < a + b - x; y++) {
            const demand = [x, y, a + b - x - y];
            const result = searchModuleFlows(
              [
                module('p0', a, 0),
                module('p1', b, 0),
                ...demand.map((rate, i) => module(`c${i}`, 0, rate)),
              ],
              ['item:plate'],
              10000,
            );
            expect(result.allocation.connections.length).toBe(minimumEdges([a, b], demand));
            expect(result.allocation.unmetInputs).toEqual([]);
            expect(result.allocation.unusedOutputs).toEqual([]);
            expect(result.optimal).toBe(true);
          }
      }
  });

  it('keeps a feasible incumbent at a budget stop instead of inventing overflow', () => {
    const result = searchModuleFlows(
      [
        module('p0', 4, 0),
        module('p1', 6, 0),
        module('c0', 3, 0),
        module('c1', 0, 5),
        module('c2', 0, 8),
      ],
      ['item:plate'],
      1,
    );
    expect(result.allocation.unmetInputs).toEqual([]);
    expect(result.allocation.unusedOutputs).toEqual([]);
    expect(result.allocation.connections.reduce((sum, flow) => sum + flow.rate, 0)).toBe(13);
    expect(result.exploredStates).toBe(1);
    expect(result.optimal).toBe(false);
  });

  it('finds exact handoffs regardless of module ordering', () => {
    const modules = [
      module('p0', 4, 0),
      module('p1', 6, 0),
      module('c0', 0, 6),
      module('c1', 0, 4),
    ];
    const result = searchModuleFlows(modules, ['item:plate']);
    expect(result.allocation.connections).toHaveLength(2);
    expect(searchModuleFlows(modules.toReversed(), ['item:plate'])).toEqual(result);
  });

  it('reroutes to conserve gross return flows without supplying the same module', () => {
    const modules = [module('a', 4, 4), module('b', 3, 3), module('c', 1, 1)];
    const result = searchModuleFlows(modules, ['item:plate']);
    expect(result.allocation.unmetInputs).toEqual([]);
    expect(result.allocation.unusedOutputs).toEqual([]);
    expect(result.allocation.connections.every((flow) => flow.producerId !== flow.consumerId)).toBe(
      true,
    );
    for (const entry of modules) {
      expect(
        result.allocation.connections
          .filter((flow) => flow.producerId === entry.id)
          .reduce((sum, flow) => sum + flow.rate, 0),
      ).toBe(entry.outputs['item:plate']);
      expect(
        result.allocation.connections
          .filter((flow) => flow.consumerId === entry.id)
          .reduce((sum, flow) => sum + flow.rate, 0),
      ).toBe(entry.inputs['item:plate']);
    }
  });
});
