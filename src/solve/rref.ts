/** Numerical threshold used for pivot and rank decisions. */
export const SOLVER_TOLERANCE = 1e-10;

export interface RrefResult {
  matrix: number[][];
  pivots: number[];
}

/**
 * Reduce a dense rectangular matrix to reduced row-echelon form.
 *
 * Only columns before `columnLimit` may become pivots. Every column is still
 * transformed, so an augmented right-hand side can be carried through without
 * being treated as another variable. The input is not mutated.
 */
export function rref(input: number[][], columnLimit = input[0]?.length ?? 0): RrefResult {
  const matrix = input.map((row) => [...row]);
  if (matrix.length === 0) return { matrix, pivots: [] };

  const columnCount = matrix[0]!.length;
  if (matrix.some((row) => row.length !== columnCount)) {
    throw new TypeError('matrix rows must all have the same length');
  }
  if (!Number.isInteger(columnLimit) || columnLimit < 0 || columnLimit > columnCount) {
    throw new RangeError('pivot column limit must be within the matrix');
  }

  let pivotRow = 0;
  const pivots: number[] = [];
  for (let pivotColumn = 0; pivotColumn < columnLimit; pivotColumn++) {
    if (pivotRow === matrix.length) break;

    let bestRow = pivotRow;
    for (let row = pivotRow + 1; row < matrix.length; row++) {
      /* Rust's Iterator::max_by returns the last equal maximum. */
      if (Math.abs(matrix[row]![pivotColumn]!) >= Math.abs(matrix[bestRow]![pivotColumn]!)) {
        bestRow = row;
      }
    }
    if (Math.abs(matrix[bestRow]![pivotColumn]!) <= SOLVER_TOLERANCE) continue;

    [matrix[pivotRow], matrix[bestRow]] = [matrix[bestRow]!, matrix[pivotRow]!];
    const pivot = matrix[pivotRow]![pivotColumn]!;

    /* Keep this eliminate-then-scale order in sync with proc-rs's reducer. */
    for (let row = 0; row < matrix.length; row++) {
      if (row === pivotRow) continue;
      const multiplier = matrix[row]![pivotColumn]! / pivot;
      matrix[row]![pivotColumn] = 0;
      for (let column = 0; column < columnCount; column++) {
        if (column === pivotColumn) continue;
        matrix[row]![column] -= matrix[pivotRow]![column]! * multiplier;
      }
    }
    for (let column = 0; column < columnCount; column++) {
      matrix[pivotRow]![column] /= pivot;
    }

    pivots.push(pivotColumn);
    pivotRow += 1;
  }

  return { matrix, pivots };
}
