import type { AssemblerDesignThroughput } from './assembler-design.ts';
import type { KernelProblem } from './kernel-problems.ts';
import { MAX_MODULE_HEIGHT, modulesForTile, type FactoryModule } from './modules.ts';
import { solveKernelTileDesign } from './tile-design/kernel-result.ts';
import type { TileDesignSearchResult } from './tile-design/result.ts';

type FoundDesign = Extract<TileDesignSearchResult, { status: 'found' }>;
type SolverOptions = Parameters<typeof solveKernelTileDesign>[2];

/** Add new parameterized layout families here; consumers render the resulting list. */
const layoutFamilies: { name: string; options: SolverOptions }[] = [
  { name: 'General', options: { mode: 'search' } },
  { name: 'HIGH single', options: { mode: 'high', pattern: 'single' } },
  { name: 'HIGH pair', options: { mode: 'high', pattern: 'pair' } },
];

export interface KernelLayoutOption {
  name: string;
  result: FoundDesign;
  requestedCopies: number;
  buildingsPerRepeat: number;
  maxBuildingsPerColumn: number;
  columns: FactoryModule[];
}

/** Find natural stacks for a fixed building demand, retaining each successful capacity option. */
export function kernelLayoutOptions(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
  machineCount: number,
  undergroundBeltReach: number,
): { options: KernelLayoutOption[]; reason: string } {
  const options: KernelLayoutOption[] = [];
  let reason = 'no solution';
  if (!Number.isFinite(machineCount) || machineCount <= 0) return { options, reason };
  for (const family of layoutFamilies) {
    const seen = new Set<string>();
    // Try intermediate capacities even when the initial design supports more than
    // one repeat. A failed larger request must not hide a successful 2× option.
    for (let repeatCount = 1; repeatCount <= MAX_MODULE_HEIGHT; repeatCount *= 2) {
      const result = solveKernelTileDesign(problem, throughput, {
        ...family.options,
        undergroundBeltReach,
        repeatCount,
        moduleHeight: MAX_MODULE_HEIGHT,
      });
      if ('success' in result || result.status !== 'found') {
        if (family.name === 'General' && repeatCount === 1)
          reason = 'success' in result ? result.message : result.reason;
        continue;
      }
      const buildingsPerRepeat = Object.keys(result.candidate.machineIds).length;
      const maxCopies = Math.min(
        result.validation.supportedCopies,
        Math.floor(MAX_MODULE_HEIGHT / result.candidate.pitch),
      );
      const columns = modulesForTile(
        problem.assemblers[0].name,
        machineCount,
        problem,
        result.candidate,
        maxCopies,
      );
      if (columns.length === 0) continue;
      const key = JSON.stringify([result.candidate, maxCopies]);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({
        name: family.name,
        result,
        requestedCopies: repeatCount,
        buildingsPerRepeat,
        maxBuildingsPerColumn: maxCopies * buildingsPerRepeat,
        columns,
      });
    }
  }
  options.sort(
    (a, b) =>
      a.columns.length - b.columns.length || b.maxBuildingsPerColumn - a.maxBuildingsPerColumn,
  );
  return { options, reason };
}
