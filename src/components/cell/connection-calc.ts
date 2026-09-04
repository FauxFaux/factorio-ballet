import type { ResourceId } from '../../types.ts';
import type { Solution } from '../../solve/index.ts';

/** One resource this recipe consumes or produces, at its actual per-second rate. */
export type ConnectionFlow = {
  resource: ResourceId;
  rate: number;
  /** Machines on the other end of this in-cell flow, relative to this recipe's machines. */
  connectedMachineCount?: number;
  machineCount?: number;
  connectedRecipes?: string[];
};
/** The two directions shown when a recipe row is opened. */
export type RecipeConnections = { inputs: ConnectionFlow[]; outputs: ConnectionFlow[] };
const FLOW_EPS = 1e-9;

/** The comparison bars describe only belt-borne items, never fluids carried by pipes. */
export function itemRateTotal(flows: ConnectionFlow[]): number {
  return flows
    .filter(({ resource }) => resource.startsWith('item:'))
    .reduce((sum, flow) => sum + flow.rate, 0);
}

/** Put the smaller side at one machine, keeping one decimal place on the other side at most. */
export function simplifiedMachineRatio(
  connectedMachineCount: number,
  machineCount: number,
): string {
  const smallest = Math.min(connectedMachineCount, machineCount);
  return `${ratioPart(connectedMachineCount / smallest)}:${ratioPart(machineCount / smallest)}`;
}

function ratioPart(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * List every material rate for this row. These are deliberately not limited to flows which find a
 * matching row in the cell: the first and last recipes in a chain still need their external input
 * and output rates, including their belt counts.
 */
export function recipeConnections(
  entry: number,
  solution: Solution,
  recipes: string[] = [],
): RecipeConnections {
  const count = solution.counts[entry];
  const inputs = solution.inputRates[entry];
  const outputs = solution.outputRates[entry];
  if (count === undefined || !inputs || !outputs) return { inputs: [], outputs: [] };
  const flows = (rates: Map<ResourceId, number>, counterparts: Map<ResourceId, number>[]) =>
    [...rates]
      .map(([resource, rate]) => {
        const connectedEntries = counterparts.flatMap((counterpart, counterpartEntry) =>
          counterpartEntry === entry ||
          !counterpart.has(resource) ||
          !solution.counts[counterpartEntry]
            ? []
            : [counterpartEntry],
        );
        const connectedMachineCount = connectedEntries.reduce(
          (total, counterpartEntry) => total + solution.counts[counterpartEntry]!,
          0,
        );
        return {
          resource,
          rate: rate * count,
          ...(connectedMachineCount > FLOW_EPS
            ? {
                connectedMachineCount,
                machineCount: count,
                ...(connectedEntries.every(
                  (counterpartEntry) => recipes[counterpartEntry] !== undefined,
                )
                  ? {
                      connectedRecipes: connectedEntries.map(
                        (counterpartEntry) => recipes[counterpartEntry]!,
                      ),
                    }
                  : {}),
              }
            : {}),
        };
      })
      .filter(({ rate }) => rate > FLOW_EPS)
      .sort(byRate);

  return {
    inputs: flows(inputs, solution.outputRates),
    outputs: flows(outputs, solution.inputRates),
  };
}

function byRate(a: ConnectionFlow, b: ConnectionFlow): number {
  return b.rate - a.rate || a.resource.localeCompare(b.resource);
}
