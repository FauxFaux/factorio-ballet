import type { Belt, MachineId, ResourceId } from '../../types.ts';
import { recipeKernelProblem } from '../../compute/modules.ts';
import { kernelLayoutOptions } from '../../compute/kernel-layout-options.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../../data/inserter-throughput.ts';
import type { Dataset } from '../../dataset/index.ts';

/** Shared layout calculation for the connections table and cell JSON export. */
export function recipeLayouts(
  ds: Dataset,
  recipe: string,
  machine: MachineId | undefined,
  inputRates: Map<ResourceId, number> | undefined,
  outputRates: Map<ResourceId, number> | undefined,
  machineCount: number | undefined,
  belt: Belt,
  progress: number,
) {
  const problem = recipeKernelProblem(
    ds.data,
    recipe,
    machine,
    inputRates ?? new Map(),
    outputRates ?? new Map(),
  );
  const throughput = {
    beltItemsPerSecond: belt.itemsPerSecond,
    inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, progress, belt),
    longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, progress, belt, 2),
  };
  const layouts = kernelLayoutOptions(
    problem,
    throughput,
    machineCount ?? 0,
    belt.undergroundLength - 1,
  );
  return { problem, ...layouts };
}
