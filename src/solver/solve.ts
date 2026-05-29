import type { ResourceId } from '../types.ts';
import { rref, type Matrix } from './matrix.ts';
import { processRates, stackRates } from './rates.ts';
import type { ActiveProcess, MaterialFlow, Problem, Solution } from './types.ts';

const TOL = 1e-10;

/**
 * Items that appear on only one side (consumed xor produced) across all
 * processes and are neither declared I/O nor a requirement. These are
 * auto-promoted to I/O slack columns so the system stays square
 * (`ALGORITHM.md` §4). Intermediates (consumed AND produced) are excluded —
 * they are balanced by the process counts, which is how cycles resolve.
 */
export function getDefaultedItems(problem: Problem): ResourceId[] {
  const inputs = new Set<ResourceId>();
  const outputs = new Set<ResourceId>();
  for (const ap of problem.processes) {
    for (const ing of ap.recipe.ingredients) inputs.add(ing.resource);
    for (const prod of ap.recipe.products) outputs.add(prod.resource);
  }
  const declared = new Set<ResourceId>([
    ...problem.io,
    ...problem.requirements.map((r) => r.resource),
  ]);

  const defaulted = new Set<ResourceId>();
  for (const item of [...inputs, ...outputs]) {
    const isIntermediate = inputs.has(item) && outputs.has(item);
    if (!isIntermediate && !declared.has(item)) defaulted.add(item);
  }
  return [...defaulted].sort();
}

export interface BuiltMatrix {
  matrix: Matrix;
  /** Item id for each row, sorted. */
  rows: ResourceId[];
  /** One process id per process column, in the order they occupy columns. */
  processIds: string[];
  /** Slack item per slack column (declared I/O then defaulted), in order. */
  slackItems: ResourceId[];
}

/**
 * Build the augmented system `[ P | S | r ]` (`ALGORITHM.md` §3): rows are
 * sorted items, columns are processes (net `-in + out`), then one slack column
 * per I/O / defaulted item, then the requirement column.
 */
export function buildMatrix(problem: Problem): BuiltMatrix {
  const processes = [...problem.processes].sort((a, b) => a.id.localeCompare(b.id));
  const defaulted = getDefaultedItems(problem);
  const slackItems = [...problem.io, ...defaulted];

  // Rows: every item referenced anywhere, so requirements/io for items no
  // process touches still get a row (and surface as infeasible if unbalanced).
  const items = new Set<ResourceId>();
  for (const ap of processes) {
    for (const ing of ap.recipe.ingredients) items.add(ing.resource);
    for (const prod of ap.recipe.products) items.add(prod.resource);
  }
  for (const item of slackItems) items.add(item);
  for (const req of problem.requirements) items.add(req.resource);
  const rows = [...items].sort();
  const rowOf = new Map(rows.map((id, i) => [id, i]));

  const ncols = processes.length + slackItems.length + 1;
  const reqCol = ncols - 1;
  const matrix: Matrix = rows.map(() => new Array<number>(ncols).fill(0));

  // Process columns: net per-second rate per item for one building.
  processes.forEach((ap, col) => {
    for (const [resource, rate] of processRates(ap)) {
      matrix[rowOf.get(resource)!][col] = rate;
    }
  });

  // Slack columns: a single 1.0 in the slack item's row.
  slackItems.forEach((item, i) => {
    matrix[rowOf.get(item)!][processes.length + i] = 1;
  });

  // Requirement column.
  for (const req of problem.requirements) {
    matrix[rowOf.get(req.resource)!][reqCol] += req.amount;
  }

  return { matrix, rows, processIds: processes.map((p) => p.id), slackItems };
}

/**
 * Solve a problem: build `[ P | S | r ]`, reduce to RREF (keeping the
 * requirement column out of the pivoting), then read building counts and net
 * material flows from the result — or report why it has no unique solution.
 */
export function solve(problem: Problem): Solution {
  const { matrix, rows, processIds } = buildMatrix(problem);
  const varCount = matrix.length === 0 ? 0 : matrix[0].length - 1;
  const reqCol = varCount;
  const reduced = rref(matrix, { pivotCols: varCount, tol: TOL });

  // Map each pivot column to the row that owns its pivot (leading 1).
  const rowOfPivotCol = new Map<number, number>();
  for (let r = 0; r < reduced.length; r++) {
    const lead = reduced[r].findIndex((v, c) => c < varCount && Math.abs(v) > TOL);
    if (lead === -1) {
      // No variable pivots this row: a nonzero RHS here means 0 = c → no solution.
      if (Math.abs(reduced[r][reqCol]) > TOL) {
        return {
          ok: false,
          reason: 'inconsistent',
          detail: 'requirements cannot be satisfied by the chosen processes',
        };
      }
    } else {
      rowOfPivotCol.set(lead, r);
    }
  }

  // Process columns are the first `processIds.length` columns; each must be a
  // pivot for its count to be uniquely determined.
  const counts: Record<string, number> = {};
  for (let col = 0; col < processIds.length; col++) {
    const row = rowOfPivotCol.get(col);
    if (row === undefined) {
      return {
        ok: false,
        reason: 'underdetermined',
        detail: `process '${processIds[col]}' is not uniquely determined — add an import/export or pin a requirement`,
      };
    }
    counts[processIds[col]] = reduced[row][reqCol];
  }

  return { ok: true, counts, materials: computeMaterials(problem.processes, counts, rows) };
}

/**
 * Recompute actual throughput from the solved counts (`ALGORITHM.md` §6):
 * scale each process's rates by its count and accumulate signed flows. Cycles
 * show up here as large consumed/produced with a near-zero net.
 */
function computeMaterials(
  processes: ActiveProcess[],
  counts: Record<string, number>,
  rows: ResourceId[],
): MaterialFlow[] {
  const flow = new Map<ResourceId, { consumed: number; produced: number }>(
    rows.map((id) => [id, { consumed: 0, produced: 0 }]),
  );
  for (const ap of processes) {
    const count = counts[ap.id];
    // Accumulate gross per-stack flows (not netted), so an item consumed AND
    // produced within one process shows both sides — this is how cycles stay
    // visible (`ALGORITHM.md` §6).
    for (const { resource, rate } of stackRates(ap)) {
      const f = flow.get(resource)!;
      const amount = rate * count;
      if (amount < 0) f.consumed += amount;
      else f.produced += amount;
    }
  }
  return rows.map((resource) => {
    const { consumed, produced } = flow.get(resource)!;
    return { resource, consumed, produced, net: consumed + produced };
  });
}
