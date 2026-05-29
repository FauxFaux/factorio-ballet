import { describe, expect, it } from 'vitest';
import { rref } from '../../src/solver/matrix.ts';

const closeTo = (m: number[][], expected: number[][]) => {
  expect(m.length).toBe(expected.length);
  m.forEach((row, r) =>
    row.forEach((v, c) => expect(v).toBeCloseTo(expected[r][c], 9)),
  );
};

describe('rref', () => {
  it('leaves an identity-augmented system as its solution', () => {
    closeTo(
      rref([
        [1, 0, 3],
        [0, 1, 4],
      ]),
      [
        [1, 0, 3],
        [0, 1, 4],
      ],
    );
  });

  it('reduces the ALGORITHM.md §3/§5 worked example', () => {
    // make_a: 5·part_1 + 2·part_2 → 5·part_3, requirement part_3 = 7.
    //          make_a  io1   io2   req
    const initial = [
      [-5, 1, 0, 0], // part_1
      [-2, 0, 1, 0], // part_2
      [5, 0, 0, 7], //  part_3
    ];
    // Keep the requirement column out of pivoting (pivotCols = 3).
    closeTo(rref(initial, { pivotCols: 3 }), [
      [1, 0, 0, 1.4], // make_a = 1.4 buildings
      [0, 1, 0, 7.0], // io part_1 = 7.0 /s
      [0, 0, 1, 2.8], // io part_2 = 2.8 /s
    ]);
  });

  it('skips an all-zero column without consuming a pivot row', () => {
    // Column 0 is entirely zero, so the pivot lands in column 1.
    closeTo(rref([[0, 2, 6]]), [[0, 1, 3]]);
  });

  it('does not mutate its input', () => {
    const input = [
      [2, 4],
      [1, 3],
    ];
    const snapshot = input.map((r) => r.slice());
    rref(input);
    expect(input).toEqual(snapshot);
  });
});
