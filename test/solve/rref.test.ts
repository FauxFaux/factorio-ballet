import { describe, expect, it } from 'vitest';
import { rref, SOLVER_TOLERANCE } from '../../src/solve/rref.ts';

function expectMatrix(actual: number[][], expected: number[][]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((row, rowIndex) => {
    expect(row).toHaveLength(expected[rowIndex]!.length);
    row.forEach((value, columnIndex) => {
      expect(value).toBeCloseTo(expected[rowIndex]![columnIndex]!, 12);
    });
  });
}

describe('rref', () => {
  it('returns an empty reduction explicitly', () => {
    expect(rref([], 4)).toEqual({ matrix: [], pivots: [] });
  });

  it('leaves an identity-augmented system as its solution', () => {
    const result = rref(
      [
        [1, 0, 3],
        [0, 1, 4],
      ],
      2,
    );
    expectMatrix(result.matrix, [
      [1, 0, 3],
      [0, 1, 4],
    ]);
    expect(result.pivots).toEqual([0, 1]);
  });

  it('reduces the old solver worked example', () => {
    const result = rref(
      [
        [-5, 1, 0, 0],
        [-2, 0, 1, 0],
        [5, 0, 0, 7],
      ],
      3,
    );
    expectMatrix(result.matrix, [
      [1, 0, 0, 1.4],
      [0, 1, 0, 7],
      [0, 0, 1, 2.8],
    ]);
    expect(result.pivots).toEqual([0, 1, 2]);
  });

  it('handles rectangular and rank-deficient matrices', () => {
    const result = rref(
      [
        [1, 2, 3],
        [2, 4, 6],
      ],
      3,
    );
    expectMatrix(result.matrix, [
      [1, 2, 3],
      [0, 0, 0],
    ]);
    expect(result.pivots).toEqual([0]);
  });

  it('matches Rust by choosing the last equally large pivot candidate', () => {
    const result = rref(
      [
        [1, 1],
        [-1, 2],
      ],
      1,
    );
    expectMatrix(result.matrix, [
      [1, -2],
      [0, 3],
    ]);
  });

  it('skips an all-zero column without consuming a pivot row', () => {
    const result = rref([[0, 2, 6]], 2);
    expectMatrix(result.matrix, [[0, 1, 3]]);
    expect(result.pivots).toEqual([1]);
  });

  it('keeps the right-hand side out of pivot consideration', () => {
    const input = [[0, 0, 7]];
    expect(rref(input, 2).pivots).toEqual([]);
    expect(rref(input, 3).pivots).toEqual([2]);
  });

  it('uses the solver tolerance inclusively', () => {
    expect(rref([[SOLVER_TOLERANCE]], 1).pivots).toEqual([]);
    expect(rref([[SOLVER_TOLERANCE * 1.01]], 1).pivots).toEqual([0]);
  });

  it('does not mutate its input', () => {
    const input = [
      [2, 4],
      [1, 3],
    ];
    const snapshot = input.map((row) => [...row]);
    rref(input);
    expect(input).toEqual(snapshot);
  });
});
