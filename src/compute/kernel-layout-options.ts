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

export type KernelLayoutCandidate = Omit<KernelLayoutOption, 'columns'>;

export interface KernelLayoutSearch {
  options: KernelLayoutCandidate[];
  reason: string;
}

/** Each step runs one bounded solve; callers can yield to the UI between steps. */
export function* searchKernelLayouts(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
  undergroundBeltReach: number,
): Generator<void, KernelLayoutSearch> {
  const options: KernelLayoutCandidate[] = [];
  let reason = 'no solution';
  for (const family of layoutFamilies) {
    const seen = new Set<string>();
    // A failed larger request must not hide a successful intermediate capacity.
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
      } else {
        const buildingsPerRepeat = Object.keys(result.candidate.machineIds).length;
        const maxCopies = Math.min(
          result.validation.supportedCopies,
          Math.floor(MAX_MODULE_HEIGHT / result.candidate.pitch),
        );
        const key = JSON.stringify([result.candidate, maxCopies]);
        if (buildingsPerRepeat > 0 && maxCopies > 0 && !seen.has(key)) {
          seen.add(key);
          options.push({
            name: family.name,
            result,
            requestedCopies: repeatCount,
            buildingsPerRepeat,
            maxBuildingsPerColumn: maxCopies * buildingsPerRepeat,
          });
        }
      }
      yield;
    }
  }
  return { options, reason };
}

/** Allocate columns without repeating the count-independent search. */
export function allocateKernelLayouts(
  problem: KernelProblem,
  search: KernelLayoutSearch,
  machineCount: number,
): { options: KernelLayoutOption[]; reason: string } {
  if (!Number.isFinite(machineCount) || machineCount <= 0)
    return { options: [], reason: 'no solution' };
  const options = search.options.map((option) => ({
    ...option,
    columns: modulesForTile(
      problem.assemblers[0].name,
      machineCount,
      problem,
      option.result.candidate,
      option.maxBuildingsPerColumn / option.buildingsPerRepeat,
    ),
  }));
  options.sort(
    (a, b) =>
      a.columns.length - b.columns.length || b.maxBuildingsPerColumn - a.maxBuildingsPerColumn,
  );
  return { options, reason: search.reason };
}

/** Synchronous adapter for offline consumers. Interactive consumers use the async cache. */
export function kernelLayoutOptions(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
  machineCount: number,
  undergroundBeltReach: number,
): { options: KernelLayoutOption[]; reason: string } {
  if (!Number.isFinite(machineCount) || machineCount <= 0)
    return { options: [], reason: 'no solution' };
  const search = searchKernelLayouts(problem, throughput, undergroundBeltReach);
  let step = search.next();
  while (!step.done) step = search.next();
  return allocateKernelLayouts(problem, step.value, machineCount);
}
