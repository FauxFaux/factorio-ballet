import { describe, expect, it } from 'vitest';
import type { Solution, SolveNote, SolveRow } from '../../src/solve/index.ts';
import { matrixSolver } from '../../src/solve/matrix.ts';
import type { ResourceId } from '../../src/types.ts';

const X = 'item:x' as ResourceId;
const Y = 'item:y' as ResourceId;
const Z = 'item:z' as ResourceId;

const row = (rates: Partial<Record<ResourceId, number>>, count?: number): SolveRow => ({
  rates: new Map(Object.entries(rates) as [ResourceId, number][]),
  count,
});

interface Fixture {
  name: string;
  rows: SolveRow[];
  counts: (number | undefined)[];
  complete: boolean;
  notes: SolveNote[];
  balance: [ResourceId, number][];
}

const fixtures: Fixture[] = [
  {
    name: 'accepts an empty input',
    rows: [],
    counts: [],
    complete: true,
    notes: [],
    balance: [],
  },
  {
    name: 'seeds the first row when no count is pinned',
    rows: [row({ [X]: 2 }), row({ [X]: -1 })],
    counts: [1, 2],
    complete: true,
    notes: [{ kind: 'seeded', entry: 0 }],
    balance: [[X, 0]],
  },
  {
    name: 'solves a forward pinned chain',
    rows: [row({ [X]: 4 }, 1), row({ [X]: -2, [Y]: 1 }), row({ [Y]: -1, [Z]: 3 })],
    counts: [1, 2, 2],
    complete: true,
    notes: [],
    balance: [
      [X, 0],
      [Y, 0],
      [Z, 6],
    ],
  },
  {
    name: 'solves a reverse pinned chain',
    rows: [row({ [Y]: -1, [Z]: 3 }), row({ [X]: -2, [Y]: 1 }), row({ [X]: 4 }, 1)],
    counts: [2, 2, 1],
    complete: true,
    notes: [],
    balance: [
      [X, 0],
      [Y, 0],
      [Z, 6],
    ],
  },
  {
    name: 'solves a dependent two-resource cycle',
    rows: [row({ [X]: -1, [Y]: 2 }, 3), row({ [X]: 2, [Y]: -4 })],
    counts: [3, 1.5],
    complete: true,
    notes: [],
    balance: [
      [X, 0],
      [Y, 0],
    ],
  },
  {
    name: 'treats duplicate rows as distinct variables',
    rows: [row({ [X]: 1 }, 1), row({ [X]: 1 }, 2), row({ [X]: -1 })],
    counts: [1, 2, 3],
    complete: true,
    notes: [],
    balance: [[X, 0]],
  },
  {
    name: 'accepts consistent redundant pins',
    rows: [row({ [X]: 2 }, 2), row({ [X]: -1 }, 4)],
    counts: [2, 4],
    complete: true,
    notes: [],
    balance: [[X, 0]],
  },
  {
    name: 'rejects inconsistent pins without changing them',
    rows: [row({ [X]: 1 }, 1), row({ [X]: -1 }, 2)],
    counts: [1, 2],
    complete: false,
    notes: [
      {
        kind: 'solver',
        entry: 0,
        detail:
          'The pinned counts cannot balance all internal resources together: change or clear a count.',
      },
    ],
    balance: [[X, -1]],
  },
  {
    name: 'does not choose between competing alternatives',
    rows: [row({ [X]: 1 }), row({ [X]: 1 }), row({ [X]: -1 }, 1)],
    counts: [undefined, undefined, 1],
    complete: false,
    notes: [{ kind: 'stranded', entry: 1 }],
    balance: [[X, -1]],
  },
  {
    name: 'leaves a disconnected row undetermined',
    rows: [row({ [X]: 1 }, 1), row({ [X]: -1 }), row({ [Y]: 5, [Z]: -2 })],
    counts: [1, undefined, undefined],
    complete: false,
    notes: [{ kind: 'stranded', entry: 2 }],
    balance: [[X, 1]],
  },
  {
    name: 'leaves an unpinned zero-rate row undetermined',
    rows: [row({ [X]: 0 }), row({ [Y]: 1 }, 7)],
    counts: [undefined, 7],
    complete: false,
    notes: [{ kind: 'stranded', entry: 0 }],
    balance: [[Y, 7]],
  },
  {
    name: 'rejects a negative unique answer without changing its pin',
    rows: [row({}, -1)],
    counts: [-1],
    complete: false,
    notes: [
      {
        kind: 'solver',
        entry: 0,
        detail:
          'Balancing these recipes requires a negative machine count, so this selection is not feasible.',
      },
    ],
    balance: [],
  },
  {
    name: 'solves a numerically awkward fractional system',
    rows: [row({ [X]: 1 / 3 }, 10 / 7), row({ [X]: -2 / 9 })],
    counts: [10 / 7, 15 / 7],
    complete: true,
    notes: [],
    balance: [[X, 0]],
  },
];

function expectCounts(actual: Solution['counts'], expected: Fixture['counts']): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((count, entry) => {
    const expectedCount = expected[entry];
    if (expectedCount === undefined) expect(count).toBeUndefined();
    else expect(count).toBeCloseTo(expectedCount, 12);
  });
}

describe('matrixSolver behavior', () => {
  it.each(fixtures)('$name', ({ rows, counts, complete, notes, balance }) => {
    const answer = matrixSolver.solve(rows);

    expectCounts(answer.counts, counts);
    expect(answer.rates).toEqual(rows.map(({ rates }) => rates));
    expect(answer.complete).toBe(complete);
    expect(answer.notes).toEqual(notes);
    expect(answer.balance.size).toBe(balance.length);
    balance.forEach(([resource, expectedRate]) => {
      expect(answer.balance.get(resource)).toBeCloseTo(expectedRate, 12);
    });
  });
});
