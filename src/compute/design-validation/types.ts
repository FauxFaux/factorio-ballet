import type { DesignColumn, DesignDirection } from '../design.ts';
import type { TileDesignInput } from '../tile-design/types.ts';

export interface TileLaneAssignment {
  entityIndex: number;
  lane: 'left' | 'right';
  resource: string;
}

export interface TileTransfer {
  inserterIndex: number;
  machineId: string;
  side: 'input' | 'output';
  resource: string;
  rate: number;
  /** Actual pickup or drop lane at the belt endpoint. */
  beltLane: 'left' | 'right';
}

export interface TileFluidAssignment {
  pipeIndex: number;
  resource: string;
}

export interface TileBoundaryTrack {
  x: number;
  kind: 'belt' | 'pipe';
  direction?: DesignDirection;
  lanes?: { left?: string; right?: string };
  /** External flow per tile, on each independently supplied/exported lane. */
  laneFlows?: {
    left?: { side: 'input' | 'output'; rate: number };
    right?: { side: 'input' | 'output'; rate: number };
  };
  resource?: string;
}

/** Claims made by a solver about its emitted, periodically repeated rectangle. */
export interface TileDesignCandidate {
  column: DesignColumn;
  width: number;
  pitch: number;
  machineIds: Record<number, string>;
  lanes: TileLaneAssignment[];
  transfers: TileTransfer[];
  fluids: TileFluidAssignment[];
  boundary: TileBoundaryTrack[];
}

export interface TileValidationIssue {
  code: string;
  message: string;
  entityIndex?: number;
  resource?: string;
}

export interface TileValidationResult {
  valid: boolean;
  issues: TileValidationIssue[];
  supportedCopies: number;
}

export type TileValidationInput = Pick<
  TileDesignInput,
  'machines' | 'boundary' | 'transport' | 'repeat'
>;
