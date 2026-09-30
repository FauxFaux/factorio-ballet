import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';

export interface TileSearchDiagnostics {
  exploredStates: number;
  capacityRejections: number;
  validationRejections: number;
  /** The actually searched family, even when the caller permits additional primitives. */
  scope:
    | 'one-machine/external-items/straight-surface-trunks'
    | 'one-machine/external-items-and-fluids/horizontal-branches/south-port-adaptor/in-tile-belt-tunnels'
    | 'mirrored-fluid-pair/horizontal-branches'
    | 'high/whole-item-belts/end-tunnels/horizontal-fluid-branches';
  /** HIGH costs are per machine; the geometry search reports costs per tile. */
  bestScore?: { area: number; transportEntities: number };
}

export type TileDesignSearchResult =
  | {
      status: 'found';
      candidate: TileDesignCandidate;
      validation: TileValidationResult;
      /** A valid incumbent; optimal is true only when the reported scope was fully searched. */
      optimal: boolean;
      stopReason: 'complete' | 'budget-exhausted' | 'first-valid';
      diagnostics: TileSearchDiagnostics;
    }
  | {
      status: 'unsupported' | 'invalid-input' | 'envelope-exhausted' | 'budget-exhausted';
      reason: string;
      diagnostics: TileSearchDiagnostics;
    };
