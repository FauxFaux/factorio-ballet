import type { Solution } from '../../solve/index.ts';
import type { ResourceId } from '../../types.ts';

/** One recipe's solved flow of an internal resource. */
export type InternalFlow = { recipe: string; rate: number };
/** The recipes which use or make one internal resource. */
export type InternalConnections = { inputs: InternalFlow[]; outputs: InternalFlow[] };

const FLOW_EPS = 1e-9;

/**
 * Turn the cell's recipe rows inside out: instead of one recipe's materials, list the recipes on
 * either side of this resource. Only rows with a worked-out count contribute a rate.
 */
export function internalConnections(
  resource: ResourceId,
  recipes: string[],
  solution: Solution,
): InternalConnections {
  const inputs: InternalFlow[] = [];
  const outputs: InternalFlow[] = [];

  solution.rates.forEach((rates, entry) => {
    const count = solution.counts[entry];
    const rate = rates.get(resource);
    if (count === undefined || rate === undefined || Math.abs(rate * count) <= FLOW_EPS) return;

    const recipe = recipes[entry];
    if (recipe === undefined) return;
    const flow = { recipe, rate: Math.abs(rate * count) };
    (rate < 0 ? inputs : outputs).push(flow);
  });

  return { inputs: sortFlows(inputs), outputs: sortFlows(outputs) };
}

function sortFlows(flows: InternalFlow[]): InternalFlow[] {
  return flows.sort((a, b) => b.rate - a.rate || a.recipe.localeCompare(b.recipe));
}
