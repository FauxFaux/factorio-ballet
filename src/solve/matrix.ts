import type { ResourceId } from '../types.ts';
import { dumbSolver } from './dumb.ts';
import type { Solution, SolveNote, SolveRow, Solver } from './index.ts';
import { rref, SOLVER_TOLERANCE } from './rref.ts';

/** Application-level tolerance for accepting and displaying a solved result. */
const EPS = 1e-9;

type MatrixStatus = 'unique' | 'underdetermined' | 'inconsistent' | 'invalid-input';

interface MatrixResult {
  status: MatrixStatus;
  candidate: number[];
  freeEntries: number[];
  negativeEntries: number[];
  maxResidual?: number;
  detail?: string;
}

/** Simultaneous linear solve over every internal resource, including cycles. */
export const matrixSolver: Solver = {
  id: 'matrix',
  human: 'Matrix',
  about:
    'Balances every internal resource simultaneously. Handles cycles but does not choose between alternatives.',
  solve: solveMatrix,
};

function solveMatrix(rows: SolveRow[]): Solution {
  const seeded = rows.length > 0 && !rows.some((row) => row.count !== undefined);
  const solveRows = rows.map((row, entry) => ({
    rates: row.rates,
    count: row.count ?? (seeded && entry === 0 ? 1 : undefined),
  }));

  let result: MatrixResult;
  try {
    result = solveSystem(solveRows);
  } catch (error) {
    return failed(rows, `The matrix solver failed: ${errorText(error)}`);
  }

  if (result.status === 'inconsistent' || result.status === 'underdetermined') {
    return fallback(rows);
  }

  const counts = result.candidate;
  const invalidEntry = counts.findIndex(
    (count, entry) =>
      !Number.isFinite(count) ||
      count < -EPS ||
      (rows[entry]!.count !== undefined && Math.abs(count - rows[entry]!.count!) > EPS),
  );
  if (
    counts.length !== rows.length ||
    invalidEntry !== -1 ||
    result.negativeEntries.length > 0 ||
    result.maxResidual === undefined ||
    !Number.isFinite(result.maxResidual) ||
    result.maxResidual > EPS
  ) {
    return failed(rows, diagnosticText(result, 'The matrix solver returned an unusable answer.'));
  }

  const notes: SolveNote[] = seeded ? [{ kind: 'seeded', entry: 0 }] : [];
  const scrubbedCounts = counts.map((count) => (Math.abs(count) < EPS ? 0 : count));
  return {
    counts: scrubbedCounts,
    rates: rows.map((row) => row.rates),
    /* Match the bridge: calculate with the candidate, then scrub only the presentation. */
    balance: scrub(balanceOf(rows, counts)),
    complete: true,
    notes,
  };
}

function fallback(rows: SolveRow[]): Solution {
  const solution = dumbSolver.solve(rows);
  if (rows.length === 0) return solution;
  return {
    ...solution,
    notes: [
      ...solution.notes,
      {
        kind: 'solver',
        entry: 0,
        detail: 'The matrix solver returned an error, so the dumb solver was used instead.',
      },
    ],
  };
}

function failed(rows: SolveRow[], detail: string, notes?: SolveNote[]): Solution {
  const counts = rows.map((row) => row.count);
  return {
    counts,
    rates: rows.map((row) => row.rates),
    balance: scrub(balanceOf(rows, counts)),
    complete: false,
    notes: notes ?? (rows.length > 0 ? [{ kind: 'solver', entry: 0, detail }] : []),
  };
}

function diagnosticText(result: MatrixResult, fallback?: string): string {
  if (result.status === 'underdetermined') {
    return 'The recipes do not determine one unique set of machine counts: type another count or remove an alternative recipe.';
  }
  if (result.status === 'inconsistent') {
    return 'The pinned counts cannot balance all internal resources together: change or clear a count.';
  }
  if (result.negativeEntries.length > 0) {
    return 'Balancing these recipes requires a negative machine count, so this selection is not feasible.';
  }
  return result.detail ?? fallback ?? 'The matrix solver could not solve this cell.';
}

function solveSystem(rows: SolveRow[]): MatrixResult {
  const signs = new Map<ResourceId, { positive: boolean; negative: boolean }>();
  for (let entry = 0; entry < rows.length; entry++) {
    const row = rows[entry]!;
    if (row.count !== undefined && !Number.isFinite(row.count)) {
      return invalid(`row ${entry} has a non-finite pinned count`);
    }
    for (const [resource, rate] of row.rates) {
      if (!Number.isFinite(rate)) {
        return invalid(
          `resource ${JSON.stringify(resource)} in row ${entry} has a non-finite rate`,
        );
      }
      if (Math.abs(rate) <= SOLVER_TOLERANCE) continue;
      const found = signs.get(resource) ?? { positive: false, negative: false };
      if (rate > 0) found.positive = true;
      else found.negative = true;
      signs.set(resource, found);
    }
  }

  const internalResources = [...signs]
    .filter(([, resourceSigns]) => resourceSigns.positive && resourceSigns.negative)
    .map(([resource]) => resource)
    .sort();
  const coefficients: number[][] = internalResources.map((resource) =>
    rows.map((row) => row.rates.get(resource) ?? 0),
  );
  const rhs: number[] = internalResources.map(() => 0);
  rows.forEach((row, entry) => {
    if (row.count === undefined) return;
    coefficients.push(rows.map((_, variable) => (variable === entry ? 1 : 0)));
    rhs.push(row.count);
  });

  const originalCoefficients = coefficients.map((row) => [...row]);
  const originalRhs = [...rhs];
  const coefficientReduction = rref(coefficients, rows.length);
  const augmented = coefficients.map((row, equation) => [...row, rhs[equation]!]);
  const augmentedRankReduction = rref(augmented, rows.length + 1);

  if (!allFinite(coefficientReduction.matrix) || !allFinite(augmentedRankReduction.matrix)) {
    return invalid('the numerical solve produced a non-finite matrix value');
  }
  if (coefficientReduction.pivots.length < augmentedRankReduction.pivots.length) {
    return {
      status: 'inconsistent',
      candidate: [],
      freeEntries: [],
      negativeEntries: [],
      detail: 'the supplied resource balances and pins are inconsistent',
    };
  }

  /* proc-rs performs this second reduction on the already rank-reduced matrix. */
  const solutionReduction = rref(augmentedRankReduction.matrix, rows.length);
  const candidate = rows.map(() => 0);
  solutionReduction.pivots.forEach((pivotColumn, pivotRow) => {
    candidate[pivotColumn] = solutionReduction.matrix[pivotRow]![rows.length]!;
  });
  if (!candidate.every(Number.isFinite)) {
    return invalid('the numerical solve produced a non-finite count');
  }

  const pivotSet = new Set(coefficientReduction.pivots);
  const freeEntries = rows.flatMap((_, entry) => (pivotSet.has(entry) ? [] : [entry]));
  const maxResidual = maximumResidual(originalCoefficients, originalRhs, candidate);
  if (!Number.isFinite(maxResidual)) {
    return invalid('the numerical solve produced a non-finite residual');
  }

  const negativeEntries = candidate.flatMap((count, entry) =>
    count < -SOLVER_TOLERANCE ? [entry] : [],
  );
  const unique = coefficientReduction.pivots.length === rows.length;
  return {
    status: unique ? 'unique' : 'underdetermined',
    candidate,
    freeEntries,
    negativeEntries,
    maxResidual,
    detail: unique
      ? negativeEntries.length > 0
        ? 'the unique algebraic solution contains negative row counts'
        : undefined
      : 'one or more row counts are not uniquely determined',
  };
}

function invalid(detail: string): MatrixResult {
  return {
    status: 'invalid-input',
    candidate: [],
    freeEntries: [],
    negativeEntries: [],
    detail,
  };
}

function allFinite(matrix: number[][]): boolean {
  return matrix.every((row) => row.every(Number.isFinite));
}

function maximumResidual(coefficients: number[][], rhs: number[], candidate: number[]): number {
  let maximum = 0;
  coefficients.forEach((row, equation) => {
    const actual = row.reduce((sum, coefficient, variable) => {
      return sum + coefficient * candidate[variable]!;
    }, 0);
    maximum = Math.max(maximum, Math.abs(actual - rhs[equation]!));
  });
  return maximum;
}

function balanceOf(rows: SolveRow[], counts: (number | undefined)[]): Map<ResourceId, number> {
  const balance = new Map<ResourceId, number>();
  rows.forEach((row, entry) => {
    const count = counts[entry];
    if (count === undefined) return;
    for (const [resource, rate] of row.rates) {
      balance.set(resource, (balance.get(resource) ?? 0) + rate * count);
    }
  });
  return balance;
}

function scrub(balance: Map<ResourceId, number>): Map<ResourceId, number> {
  for (const [resource, rate] of balance) {
    if (Math.abs(rate) < EPS) balance.set(resource, 0);
  }
  return balance;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
