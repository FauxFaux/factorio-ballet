import type { ResourceId } from '../../types.ts';
import type { Solution } from '../../solve/index.ts';

/** One resource this recipe consumes or produces, at its actual per-second rate. */
export type ConnectionFlow = { resource: ResourceId; rate: number };
/** The two directions shown when a recipe row is opened. */
export type RecipeConnections = { inputs: ConnectionFlow[]; outputs: ConnectionFlow[] };
const FLOW_EPS = 1e-9;

/** The comparison bars describe only belt-borne items, never fluids carried by pipes. */
export function itemRateTotal(flows: ConnectionFlow[]): number {
  return flows
    .filter(({ resource }) => resource.startsWith('item:'))
    .reduce((sum, flow) => sum + flow.rate, 0);
}

/**
 * List every material rate for this row. These are deliberately not limited to flows which find a
 * matching row in the cell: the first and last recipes in a chain still need their external input
 * and output rates, including their belt counts.
 */
export function recipeConnections(entry: number, solution: Solution): RecipeConnections {
  const count = solution.counts[entry];
  const inputs = solution.inputRates[entry];
  const outputs = solution.outputRates[entry];
  if (count === undefined || !inputs || !outputs) return { inputs: [], outputs: [] };
  const flows = (rates: Map<ResourceId, number>) =>
    [...rates]
      .map(([resource, rate]) => ({ resource, rate: rate * count }))
      .filter(({ rate }) => rate > FLOW_EPS)
      .sort(byRate);

  return {
    inputs: flows(inputs),
    outputs: flows(outputs),
  };
}

function byRate(a: ConnectionFlow, b: ConnectionFlow): number {
  return b.rate - a.rate || a.resource.localeCompare(b.resource);
}
