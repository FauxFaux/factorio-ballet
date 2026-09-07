import { describe, expect, it } from 'vitest';
import { boundarySuggestions } from '../../src/solve/boundary-suggestions.ts';
import { dumbSolver, matrixSolver, type SolveRow } from '../../src/solve/index.ts';
import type { ResourceId } from '../../src/types.ts';

const X: ResourceId = 'item:x';
const Y: ResourceId = 'item:y';
const Z: ResourceId = 'item:z';
const row = (rates: [ResourceId, number][], count?: number): SolveRow => ({
  rates: new Map(rates),
  count,
});
const rows = [
  row(
    [
      [X, 2],
      [Y, 1],
    ],
    1,
  ),
  row([
    [X, -1],
    [Y, -1],
  ]),
];
const diagnose = (
  input: SolveRow[],
  imports = new Set<ResourceId>(),
  exports = new Set<ResourceId>(),
) => boundarySuggestions(input, dumbSolver.solve(input), dumbSolver, imports, exports);

describe('boundary suggestions', () => {
  it('checks balanced resources too and derives direction from the trial balance', () => {
    expect(dumbSolver.solve(rows).balance.get(X)).toBe(0);
    expect(diagnose(rows)).toEqual([
      { resource: X, direction: 'export', rate: 1, requiresMatrix: false },
      { resource: Y, direction: 'import', rate: -1, requiresMatrix: false },
    ]);
    expect(rows[1].count).toBeUndefined();
    expect(rows[1].rates.get(X)).toBe(-1);
  });

  it('does not treat fallback or free-variable answers as verified alternatives', () => {
    expect(
      diagnose([
        ...rows,
        row([
          [X, -1],
          [Y, -1],
        ]),
      ]),
    ).toEqual([]);
  });

  it('does not override incompatible pins', () => {
    expect(diagnose([rows[0], { ...rows[1], count: 3 }])).toEqual([]);
  });

  it('checks existing boundary directions against the full physical flows', () => {
    const withByproduct = [
      row(
        [
          [X, 2],
          [Y, 1],
          [Z, 1],
        ],
        1,
      ),
      rows[1],
    ];
    expect(diagnose(withByproduct, new Set([Z]))).toEqual([]);
    expect(diagnose(withByproduct, new Set(), new Set([Z]))).toHaveLength(2);
  });

  it('preserves the implicit first-row pin in every trial', () => {
    expect(diagnose([{ ...rows[0], count: undefined }, rows[1]])).toEqual(diagnose(rows));
  });

  it('does not propose a boundary for a healthy cycle that only the dumb solver fails', () => {
    const cycle = [
      row([[X, 1]], 1),
      row([
        [X, -1],
        [Y, 1],
      ]),
      row([
        [Y, -1],
        [X, 0.5],
      ]),
    ];
    expect(dumbSolver.solve(cycle).balance.get(X)).toBe(0.5);
    expect(matrixSolver.solve(cycle).counts).toEqual([1, 2, 2]);
    expect(diagnose(cycle)).toEqual([]);
  });

  it('does not propose fixes for invalid numerical input', () => {
    expect(diagnose([{ ...rows[0], count: NaN }, rows[1]])).toEqual([]);
    expect(
      diagnose([
        row(
          [
            [X, Infinity],
            [Y, 1],
          ],
          1,
        ),
        rows[1],
      ]),
    ).toEqual([]);
  });
});
