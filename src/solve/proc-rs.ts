import { solve_rows } from 'proc-web';
import type { ResourceId } from '../types.ts';
import type { Solution, SolveNote, SolveRow, Solver } from './index.ts';

const EPS = 1e-9;

type ProcStatus = 'unique' | 'underdetermined' | 'inconsistent' | 'invalid-input';

interface ProcResult {
  status: ProcStatus;
  counts: { id: string; count: number }[];
  coefficientRank: number;
  augmentedRank: number;
  variableCount: number;
  equationCount: number;
  maxResidual?: number;
  freeRowIds: string[];
  negativeRowIds: string[];
  diagnostic?: { code: string; detail: string };
}

/** Simultaneous linear solve over every internal resource, including cycles. */
export const procRsSolver: Solver = {
  id: 'proc-rs',
  human: 'Matrix',
  about:
    'Balances every internal resource simultaneously. Handles cycles but does not choose between alternatives.',
  solve: solveProcRs,
};

function solveProcRs(rows: SolveRow[]): Solution {
  const seeded = rows.length > 0 && !rows.some((row) => row.count !== undefined);
  const requestRows = rows.map((row, entry) => ({
    id: rowId(entry),
    rates: [...row.rates].map(([resource, rate]) => ({ resource, rate })),
    count: row.count ?? (seeded && entry === 0 ? 1 : undefined),
  }));

  let result: ProcResult;
  try {
    result = solve_rows({ rows: requestRows }) as ProcResult;
  } catch (error) {
    return failed(rows, `The matrix solver failed: ${errorText(error)}`);
  }

  if (result.status !== 'unique') {
    const detail = diagnosticText(result);
    const freeEntries = result.freeRowIds.map(entryOf).filter((entry) => entry !== undefined);
    return failed(
      rows,
      detail,
      result.status === 'underdetermined' && freeEntries.length > 0
        ? freeEntries.map((entry) => ({ kind: 'stranded', entry }))
        : undefined,
    );
  }

  const byId = new Map(result.counts.map(({ id, count }) => [id, count]));
  const counts = rows.map((_, entry) => byId.get(rowId(entry)));
  const invalidEntry = counts.findIndex(
    (count, entry) =>
      count === undefined ||
      !Number.isFinite(count) ||
      count < -EPS ||
      (rows[entry]!.count !== undefined && Math.abs(count - rows[entry]!.count!) > EPS),
  );
  if (
    invalidEntry !== -1 ||
    result.negativeRowIds.length > 0 ||
    result.maxResidual === undefined ||
    !Number.isFinite(result.maxResidual) ||
    result.maxResidual > EPS
  ) {
    return failed(rows, diagnosticText(result, 'The matrix solver returned an unusable answer.'));
  }

  const notes: SolveNote[] = seeded ? [{ kind: 'seeded', entry: 0 }] : [];
  return {
    counts: counts.map((count) => (Math.abs(count!) < EPS ? 0 : count)),
    rates: rows.map((row) => row.rates),
    balance: scrub(balanceOf(rows, counts)),
    complete: true,
    notes,
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

function diagnosticText(result: ProcResult, fallback?: string): string {
  if (result.status === 'underdetermined') {
    return 'The recipes do not determine one unique set of machine counts: type another count or remove an alternative recipe.';
  }
  if (result.status === 'inconsistent') {
    return 'The pinned counts cannot balance all internal resources together: change or clear a count.';
  }
  if (result.negativeRowIds.length > 0) {
    return 'Balancing these recipes requires a negative machine count, so this selection is not feasible.';
  }
  return result.diagnostic?.detail ?? fallback ?? 'The matrix solver could not solve this cell.';
}

function rowId(entry: number): string {
  return `row:${entry}`;
}

function entryOf(id: string): number | undefined {
  const match = /^row:(\d+)$/.exec(id);
  return match ? Number(match[1]) : undefined;
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
