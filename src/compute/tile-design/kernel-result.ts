import type { AssemblerDesignThroughput } from '../assembler-design.ts';
import type { KernelProblem } from '../kernel-problems.ts';
import { normalizeTileDesignInput } from './problem.ts';
import { solveTileDesignWithMode, type TileSolverMode } from './solver.ts';
import type { HighDesignOptions } from './high/solve.ts';
import type { TileDesignOptions } from './types.ts';

/** Use the same tile search settings for the preview and its JSON export. */
export function solveKernelTileDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
  options: Pick<TileDesignOptions, 'repeatCount' | 'moduleHeight'> &
    HighDesignOptions & {
      mode?: TileSolverMode;
      /** Hidden cells; pass the selected belt's undergroundLength minus one. */
      undergroundBeltReach?: number;
    } = {},
) {
  const normalized = normalizeTileDesignInput(problem, {
    transport: {
      beltLaneCapacity: throughput.beltItemsPerSecond / 2,
      undergroundBeltReach: options.undergroundBeltReach ?? 4,
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
    ...options,
  });
  return normalized.success
    ? solveTileDesignWithMode(normalized.input, options.mode ?? 'search', options)
    : normalized;
}
