import { validateTileDesign } from '../../design-validation/validate.ts';
import type { TileDesignSearchResult, TileSearchDiagnostics } from '../result.ts';
import type { TileDesignInput } from '../types.ts';
import { externalFlowFailure, validateSearchInput } from '../validation.ts';
import { allocateHighBelts, compareHighScores } from './allocate.ts';
import { emitHighTile } from './emit.ts';
import { highFrames } from './geometry.ts';

export interface HighDesignOptions {
  /** Pair is denser but needs a longer tunnel and has half the end inserter capacity. */
  pattern?: 'single' | 'pair' | 'auto';
}

/** A separate policy over the same normalized input and validated output contract.
 * This solver optimizes within the HIGH family, measuring cost per installed machine.
 * Outputs may span dedicated belts; each belt has only one resource and flow role. */
export function solveHighTileDesign(
  input: TileDesignInput,
  { pattern = 'auto' }: HighDesignOptions = {},
): TileDesignSearchResult {
  const diagnostics: TileSearchDiagnostics = {
    exploredStates: 0,
    capacityRejections: 0,
    validationRejections: 0,
    scope: 'high/whole-item-belts/end-tunnels/horizontal-fluid-branches',
  };
  const failure = (
    status: Exclude<TileDesignSearchResult['status'], 'found'>,
    reason: string,
  ): TileDesignSearchResult => ({ status, reason, diagnostics });
  const invalid = validateSearchInput(input);
  if (invalid) return failure('invalid-input', invalid);
  const unsupported = externalFlowFailure(input);
  if (unsupported) return failure('unsupported', unsupported);
  if (!input.envelope.primitives.includes('surface'))
    return failure('unsupported', 'Surface trunks are required.');
  if (input.transport.inserters.some(({ reach }) => reach !== 1 && reach !== 2))
    return failure('unsupported', 'Only one- and two-tile inserter reach is supported.');
  const machine = input.machines[0];
  if (machine.inputs.items.length + machine.outputs.items.length > 7)
    return failure(
      'unsupported',
      'HIGH designs need at least one belt per gross item flow, with at most seven belts.',
    );
  if (
    !machine.orientations.some(({ rotation }) =>
      [2, 3].includes(
        rotation === 'east' || rotation === 'west' ? machine.size.height : machine.size.width,
      ),
    )
  )
    return failure(
      'unsupported',
      'HIGH designs require an allowed two- or three-tile-wide machine orientation.',
    );
  let exhausted = false;
  const visit = () => {
    if (diagnostics.exploredStates >= input.envelope.maxStates) {
      exhausted = true;
      return false;
    }
    diagnostics.exploredStates++;
    return true;
  };
  let best: Extract<TileDesignSearchResult, { status: 'found' }> | undefined;
  const patterns: (1 | 2)[] = pattern === 'single' ? [1] : pattern === 'pair' ? [2] : [1, 2];
  for (const copies of patterns) {
    for (const frame of highFrames(input, copies, visit)) {
      const allocation = allocateHighBelts(input, frame, visit);
      if (!allocation) {
        diagnostics.capacityRejections++;
        if (exhausted) break;
        continue;
      }
      if (diagnostics.bestScore && compareHighScores(allocation.score, diagnostics.bestScore) >= 0)
        continue;
      const candidate = emitHighTile(input, frame, allocation.assignments);
      const validation = validateTileDesign(input, candidate);
      if (!validation.valid) {
        diagnostics.validationRejections++;
        continue;
      }
      diagnostics.bestScore = allocation.score;
      best = {
        status: 'found',
        candidate,
        validation,
        optimal: false,
        stopReason: 'budget-exhausted',
        diagnostics,
      };
      if (exhausted) break;
    }
    if (exhausted) break;
  }
  if (best) {
    best.optimal = !exhausted && diagnostics.validationRejections === 0;
    best.stopReason = exhausted ? 'budget-exhausted' : 'complete';
    return best;
  }
  return failure(
    exhausted ? 'budget-exhausted' : 'envelope-exhausted',
    exhausted
      ? 'The state budget ended before a valid HIGH design was found.'
      : 'No HIGH subset fits the belt reach, edge sites, fluid ports, lane rates, width, pitch, and repeat bounds.',
  );
}
