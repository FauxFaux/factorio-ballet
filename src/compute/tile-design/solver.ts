import { solveHighTileDesign, type HighDesignOptions } from './high/solve.ts';
import { solveTileDesign } from './search.ts';
import type { TileDesignSearchResult } from './result.ts';
import type { TileDesignInput } from './types.ts';

export type TileSolverMode = 'search' | 'high' | 'auto';

/** Keep policies explicit: AUTO prefers a readable HIGH result, then falls back to
 * the general geometry search. It does not claim optimality across both families. */
export function solveTileDesignWithMode(
  input: TileDesignInput,
  mode: TileSolverMode,
  highOptions: HighDesignOptions = {},
): TileDesignSearchResult {
  if (mode === 'search') return solveTileDesign(input);
  const high = solveHighTileDesign(input, highOptions);
  if (mode === 'high' || high.status === 'found' || high.status === 'invalid-input') return high;
  const remaining = input.envelope.maxStates - high.diagnostics.exploredStates;
  if (remaining < 1) return { ...high, status: 'budget-exhausted' };
  const result = solveTileDesign({
    ...input,
    envelope: { ...input.envelope, maxStates: remaining },
  });
  return {
    ...result,
    diagnostics: {
      ...result.diagnostics,
      exploredStates: high.diagnostics.exploredStates + result.diagnostics.exploredStates,
      capacityRejections:
        high.diagnostics.capacityRejections + result.diagnostics.capacityRejections,
      validationRejections:
        high.diagnostics.validationRejections + result.diagnostics.validationRejections,
    },
  };
}
