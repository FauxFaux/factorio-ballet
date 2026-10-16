import { entryMachine, type Cell } from '../../cell.ts';
import type { Dataset } from '../../dataset/index.ts';
import type { Solution } from '../../solve/index.ts';
import { recipeName } from '../../data/index.ts';
import type { BobProblem, Rates } from './types.ts';
import type { ResourceId } from '../../types.ts';
import { itemOnlyBobProblem } from './item-problem.ts';

/** Keep the solved load: ceil physical copies, with a partially loaded final machine. */
export function bobProblem(
  ds: Dataset,
  cell: Cell,
  solution: Solution,
  progress: number,
  inputs: ResourceId[],
  outputs: ResourceId[],
): BobProblem {
  if (!cell.entries.length) throw new Error('Add a recipe to place assemblers.');
  if (!solution.complete)
    throw new Error('Resolve the cell’s machine counts before placing assemblers.');
  const machines: BobProblem['machines'] = [];
  cell.entries.forEach((entry, row) => {
    const count = solution.counts[row];
    const recipe = ds.data.recipes[entry.recipe];
    const machineId = recipe && entryMachine(entry, recipe, progress, ds);
    const machine = machineId && ds.data.machines[machineId];
    if (!machine || count === undefined || !Number.isFinite(count) || count < 0) {
      throw new Error(`Select a valid machine and count for ${entry.recipe}.`);
    }
    if (machines.length + Math.ceil(count - 1e-9) > 24) {
      throw new Error(
        'This experimental search supports at most 24 assemblers. Reduce the cell’s scale.',
      );
    }
    for (let copy = 0; copy < Math.ceil(count - 1e-9); copy++) {
      const load = Math.min(1, count - copy);
      const scaled = (rates: Map<ResourceId, number>): Rates =>
        Object.fromEntries(
          [...rates].filter(([, rate]) => rate > 0).map(([id, rate]) => [id, rate * load]),
        );
      machines.push({
        id: `${row}:${copy}`,
        label: `${recipeName(ds.data, entry.recipe)} ${copy + 1}`,
        size: machine.size,
        inputs: scaled(solution.inputRates[row]),
        outputs: scaled(solution.outputRates[row]),
      });
    }
  });
  return itemOnlyBobProblem({ machines, inputs, outputs });
}
