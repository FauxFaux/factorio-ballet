import type { ResourceId } from '../../types.ts';
import type { Solution } from '../../solve.ts';

/** One resource this recipe consumes or produces, at its actual per-second rate. */
export type ConnectionFlow = { resource: ResourceId; rate: number };
/** The two directions shown when a recipe row is opened. */
export type RecipeConnections = { inputs: ConnectionFlow[]; outputs: ConnectionFlow[] };
const FLOW_EPS = 1e-9;

/**
 * List every material rate for this row. These are deliberately not limited to flows which find a
 * matching row in the cell: the first and last recipes in a chain still need their external input
 * and output rates, including their belt counts.
 */
export function recipeConnections(entry: number, solution: Solution): RecipeConnections {
  const count = solution.counts[entry];
  const rates = solution.rates[entry];
  if (count === undefined || !rates) return { inputs: [], outputs: [] };

  const flows = [...rates]
    .map(([resource, rate]) => ({ resource, rate: rate * count }))
    .filter(({ rate }) => Math.abs(rate) > FLOW_EPS);

  return {
    inputs: flows
      .filter(({ rate }) => rate < 0)
      .map(({ resource, rate }) => ({ resource, rate: -rate }))
      .sort(byRate),
    outputs: flows.filter(({ rate }) => rate > 0).sort(byRate),
  };
}

function byRate(a: ConnectionFlow, b: ConnectionFlow): number {
  return b.rate - a.rate || a.resource.localeCompare(b.resource);
}
