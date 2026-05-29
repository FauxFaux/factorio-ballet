/** A dense matrix as rows of numbers. All rows are the same length. */
export type Matrix = number[][];

export interface RrefOptions {
  /**
   * Number of leading columns eligible to hold a pivot. Defaults to all
   * columns. Set this to the variable-block width to keep an augmented
   * requirement column out of the pivoting (textbook-correct for an augmented
   * system; see `ALGORITHM.md` §10.3 #3).
   */
  pivotCols?: number;
  /** Magnitude below which a pivot candidate is treated as zero. Default 1e-10. */
  tol?: number;
  /** Magnitude below which a computed value is scrubbed to exactly 0. Default 1e-12. */
  scrub?: number;
}

/**
 * Reduce a matrix to reduced row-echelon form (Gauss–Jordan) with partial
 * pivoting. Does not mutate the input — returns a new matrix. See
 * `ALGORITHM.md` §5.
 */
export function rref(input: Matrix, opts: RrefOptions = {}): Matrix {
  const tol = opts.tol ?? 1e-10;
  const scrub = opts.scrub ?? 1e-12;

  const m = input.map((row) => row.slice());
  const nrows = m.length;
  const ncols = nrows > 0 ? m[0].length : 0;
  const pivotCols = opts.pivotCols ?? ncols;

  let pivotRow = 0;
  for (let pivotCol = 0; pivotRow < nrows && pivotCol < pivotCols; pivotCol++) {
    // Partial pivot: pick the row at/below pivotRow with the largest magnitude.
    let best = pivotRow;
    for (let r = pivotRow + 1; r < nrows; r++) {
      if (Math.abs(m[r][pivotCol]) > Math.abs(m[best][pivotCol])) best = r;
    }
    if (Math.abs(m[best][pivotCol]) < tol) continue; // column effectively zero — skip it

    [m[pivotRow], m[best]] = [m[best], m[pivotRow]];

    // Scale the pivot row so the pivot becomes 1.
    const pivotVal = m[pivotRow][pivotCol];
    for (let c = 0; c < ncols; c++) {
      m[pivotRow][c] = scrubbed(m[pivotRow][c] / pivotVal, scrub);
    }

    // Eliminate the pivot column from every other row (above and below → full RREF).
    for (let r = 0; r < nrows; r++) {
      if (r === pivotRow) continue;
      const f = m[r][pivotCol];
      if (f === 0) continue;
      for (let c = 0; c < ncols; c++) {
        m[r][c] = scrubbed(m[r][c] - f * m[pivotRow][c], scrub);
      }
    }
    pivotRow++;
  }
  return m;
}

function scrubbed(value: number, scrub: number): number {
  return Math.abs(value) < scrub ? 0 : value;
}
