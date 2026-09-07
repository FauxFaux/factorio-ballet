import type { ResourceId } from '../types.ts';
import type { Solution, SolveRow, Solver } from './index.ts';
import { matrixSolver } from './matrix.ts';

const EPS = 1e-9;

/** A verified alternative boundary, not a leftover in the currently displayed answer. */
export interface BoundarySuggestion {
  resource: ResourceId;
  direction: 'import' | 'export';
  /** Signed physical balance after removing this resource's equation. */
  rate: number;
  requiresMatrix: boolean;
}

/**
 * Diagnose the cell at its boundary, for either solver. Testing every internal equation also
 * finds resources whose apparent balance is obtained at the expense of other resources.
 * Trials use the raw matrix solver (no recursive diagnostics) and require a unique answer.
 */
export function boundarySuggestions(
  rows: SolveRow[],
  solution: Solution,
  solver: Solver,
  imports: ReadonlySet<ResourceId>,
  exports: ReadonlySet<ResourceId>,
): BoundarySuggestion[] {
  const external = new Set([...imports, ...exports]);
  const resources = new Set(rows.flatMap((row) => [...row.rates.keys()]));
  const internal = [...resources].filter(
    (id) =>
      !external.has(id) &&
      rows.some((row) => (row.rates.get(id) ?? 0) > EPS) &&
      rows.some((row) => (row.rates.get(id) ?? 0) < -EPS),
  );
  const balance = (answer: Solution, id: ResourceId) =>
    rows.reduce((sum, row, i) => sum + (row.rates.get(id) ?? 0) * (answer.counts[i] ?? 0), 0);
  const valid = (answer: Solution, omitted?: ResourceId) =>
    answer.complete &&
    answer.counts.length === rows.length &&
    answer.counts.every(
      (count, i) =>
        count !== undefined &&
        Number.isFinite(count) &&
        count >= 0 &&
        (rows[i].count === undefined || Math.abs(count - rows[i].count!) <= EPS),
    ) &&
    internal.every((id) => id === omitted || Math.abs(balance(answer, id)) <= EPS) &&
    [...imports].every((id) => balance(answer, id) <= EPS) &&
    [...exports].every((id) => balance(answer, id) >= -EPS);
  if (valid(solution)) return [];

  const without = (omitted?: ResourceId) =>
    rows.map((row) => ({
      ...row,
      rates: new Map([...row.rates].filter(([id]) => id !== omitted && !external.has(id))),
    }));
  const unique = (answer: Solution) => answer.notes.every((note) => note.kind === 'seeded');
  // A propagation-only failure in an otherwise feasible cycle does not need a new boundary.
  const original = matrixSolver.solve(without());
  if (unique(original) && valid(original)) return [];

  const suggestions: BoundarySuggestion[] = [];
  for (const resource of internal) {
    const trialRows = without(resource);
    const trial = matrixSolver.solve(trialRows);
    if (!unique(trial) || !valid(trial, resource)) continue;
    const rate = balance(trial, resource);
    if (!Number.isFinite(rate) || Math.abs(rate) <= EPS) continue;
    const selected = solver === matrixSolver ? trial : solver.solve(trialRows);
    const selectedRate = balance(selected, resource);
    suggestions.push({
      resource,
      direction: rate > 0 ? 'export' : 'import',
      rate,
      requiresMatrix:
        !valid(selected, resource) || (rate > 0 ? selectedRate < -EPS : selectedRate > EPS),
    });
  }
  return suggestions.sort(
    (a, b) => a.direction.localeCompare(b.direction) || a.resource.localeCompare(b.resource),
  );
}
