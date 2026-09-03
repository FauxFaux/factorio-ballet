import { describe, expect, it } from 'vitest';
import { matrixSolver } from '../../src/solve/matrix.ts';
import type { SolveRow } from '../../src/solve/index.ts';
import type { ResourceId } from '../../src/types.ts';

const X = 'item:x' as ResourceId;
const Y = 'item:y' as ResourceId;
const Z = 'item:z' as ResourceId;

const row = (rates: Partial<Record<ResourceId, number>>, count?: number): SolveRow => ({
  rates: new Map(Object.entries(rates) as [ResourceId, number][]),
  count,
});

const solve = (...rows: SolveRow[]) => matrixSolver.solve(rows);

describe('matrixSolver', () => {
  it('has nothing to say about an empty cell', () => {
    expect(solve()).toEqual({
      counts: [],
      rates: [],
      balance: new Map(),
      complete: true,
      notes: [],
    });
  });

  it('seeds and solves a forward chain', () => {
    const answer = solve(row({ [X]: 4 }), row({ [X]: -2, [Y]: 1 }), row({ [Y]: -1, [Z]: 3 }));
    expect(answer.counts).toEqual([1, 2, 2]);
    expect(answer.notes).toEqual([{ kind: 'seeded', entry: 0 }]);
    expect(answer.balance.get(X)).toBe(0);
    expect(answer.balance.get(Y)).toBe(0);
  });

  it('solves a chain pinned in reverse order', () => {
    const answer = solve(row({ [Y]: -1, [Z]: 3 }), row({ [X]: -2, [Y]: 1 }), row({ [X]: 4 }, 1));
    expect(answer.counts).toEqual([2, 2, 1]);
  });

  it('solves a dependent two-resource cycle simultaneously', () => {
    const answer = solve(row({ [X]: -1, [Y]: 2 }, 3), row({ [X]: 2, [Y]: -4 }));
    expect(answer.counts[1]).toBeCloseTo(1.5, 12);
    expect(answer.complete).toBe(true);
    expect(answer.balance.get(X)).toBe(0);
    expect(answer.balance.get(Y)).toBe(0);
  });

  it('allows duplicate row semantics at distinct indices', () => {
    const answer = solve(row({ [X]: 1 }, 1), row({ [X]: 1 }, 2), row({ [X]: -1 }));
    expect(answer.counts).toEqual([1, 2, 3]);
  });

  it('accepts consistent redundant pins', () => {
    const answer = solve(row({ [X]: 2 }, 2), row({ [X]: -1 }, 4));
    expect(answer.counts).toEqual([2, 4]);
    expect(answer.complete).toBe(true);
  });

  it('rejects inconsistent pins without changing them', () => {
    const answer = solve(row({ [X]: 1 }, 1), row({ [X]: -1 }, 2));
    expect(answer.counts).toEqual([1, 2]);
    expect(answer.complete).toBe(false);
    expect(answer.notes).toEqual([
      {
        kind: 'solver',
        entry: 0,
        detail:
          'The pinned counts cannot balance all internal resources together: change or clear a count.',
      },
    ]);
  });

  it('does not choose between competing alternatives', () => {
    const answer = solve(row({ [X]: 1 }), row({ [X]: 1 }), row({ [X]: -1 }, 1));
    expect(answer.counts).toEqual([undefined, undefined, 1]);
    expect(answer.complete).toBe(false);
    expect(answer.notes).toEqual([{ kind: 'stranded', entry: 1 }]);
  });

  it('reports a disconnected row as free', () => {
    const answer = solve(row({ [X]: 1 }, 1), row({ [X]: -1 }), row({ [Y]: 5, [Z]: -2 }));
    expect(answer.counts).toEqual([1, undefined, undefined]);
    expect(answer.notes).toEqual([{ kind: 'stranded', entry: 2 }]);
  });

  it('reports an unpinned zero-rate row as free', () => {
    const answer = solve(row({ [X]: 0 }), row({ [Y]: 1 }, 7));
    expect(answer.counts).toEqual([undefined, 7]);
    expect(answer.notes).toEqual([{ kind: 'stranded', entry: 0 }]);
  });

  it('rejects a negative unique answer without clamping it', () => {
    const answer = solve(row({}, -1));
    expect(answer.counts).toEqual([-1]);
    expect(answer.complete).toBe(false);
    expect(answer.notes[0]).toMatchObject({
      kind: 'solver',
      detail:
        'Balancing these recipes requires a negative machine count, so this selection is not feasible.',
    });
  });

  it('solves a numerically awkward fractional system', () => {
    const answer = solve(row({ [X]: 1 / 3 }, 10 / 7), row({ [X]: -2 / 9 }));
    expect(answer.counts[1]).toBeCloseTo(15 / 7, 12);
    expect(answer.balance.get(X)).toBe(0);
  });

  it('computes edge balance before clamping a tiny count for display', () => {
    const answer = solve(row({ [X]: 1e10 }, 5e-10));
    expect(answer.counts).toEqual([0]);
    expect(answer.balance.get(X)).toBe(5);
  });

  it('rejects non-finite pins and rates', () => {
    const pinned = solve(row({}, Number.NaN));
    expect(pinned.complete).toBe(false);
    expect(pinned.notes[0]).toMatchObject({
      kind: 'solver',
      detail: expect.stringContaining('pin'),
    });

    const rated = solve(row({ [X]: Number.POSITIVE_INFINITY }));
    expect(rated.complete).toBe(false);
    expect(rated.notes[0]).toMatchObject({
      kind: 'solver',
      detail: expect.stringContaining('rate'),
    });
  });
});
