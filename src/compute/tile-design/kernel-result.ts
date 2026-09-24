import type { AssemblerDesignThroughput } from '../assembler-design.ts';
import type { KernelProblem } from '../kernel-problems.ts';
import { normalizeTileDesignInput } from './problem.ts';
import { solveTileDesign } from './search.ts';

/** Use the same tile search settings for the preview and its JSON export. */
export function solveKernelTileDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
) {
  const normalized = normalizeTileDesignInput(problem, {
    transport: {
      beltLaneCapacity: throughput.beltItemsPerSecond / 2,
      undergroundBeltReach: 4,
      undergroundPipeReach: 10,
      inserters: [
        { id: 'ordinary', capacity: throughput.inserterItemsPerSecond, reach: 1 },
        { id: 'long', capacity: throughput.longInserterItemsPerSecond, reach: 2 },
      ],
      fluidThroughput: 'unlimited',
    },
    envelope: {
      maxWidth: 16,
      maxPitch: 12,
      primitives: ['surface', 'underground', 'branch'],
      maxStates: 10_000,
    },
  });
  return normalized.success ? solveTileDesign(normalized.input) : normalized;
}
