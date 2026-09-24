import type { DesignDirection } from '../design.ts';
import type { MachineSize, ResourceId } from '../../types.ts';

export type FluidId = Extract<ResourceId, `fluid:${string}`>;

/** A named item transfer rate, used for either input or output. */
export interface ItemFlow {
  resource: string;
  rate: number;
}

/** One fluid's alternative connections in north-facing local coordinates. Transform its positions
 * with the selected machine orientation while keeping the resource attached to this access. */
export interface FluidAccess {
  resource: FluidId;
  positions: { position: { x: number; y: number }; direction: DesignDirection }[];
}

export interface MachineFlows {
  items: ItemFlow[];
  fluids: FluidAccess[];
}

export interface BoundaryFlows {
  items: ItemFlow[];
  fluids: FluidId[];
}

/** Mirror local x coordinates before applying the cardinal rotation. */
export interface TileMachineOrientation {
  rotation: DesignDirection;
  mirrored: boolean;
}

export interface TileMachine {
  id: string;
  size: MachineSize;
  orientations: TileMachineOrientation[];
  inputs: MachineFlows;
  outputs: MachineFlows;
}

export interface TileBoundary {
  inputs: BoundaryFlows;
  outputs: BoundaryFlows;
}

export interface TileTransportRules {
  beltLaneCapacity: number;
  undergroundBeltReach: number;
  undergroundPipeReach: number;
  inserters: { id: string; capacity: number; reach: number }[];
  fluidThroughput: 'unlimited';
}

export interface TileSearchEnvelope {
  maxWidth: number;
  maxPitch: number;
  primitives: readonly ('surface' | 'underground' | 'branch' | 'direct-insertion')[];
  maxStates: number;
}

export interface TileDesignOptions {
  transport: TileTransportRules;
  envelope: TileSearchEnvelope;
  repeatCount?: number;
  moduleHeight?: number;
}

export interface TileDesignInput {
  machines: TileMachine[];
  boundary: TileBoundary;
  transport: TileTransportRules;
  envelope: TileSearchEnvelope;
  repeat: { count: number; moduleHeight?: number };
}

export interface InvalidTileDesignInput {
  kind: 'invalid-input';
  code:
    | 'invalid-rate'
    | 'invalid-resource'
    | 'invalid-machine'
    | 'invalid-fluid'
    | 'unbalanced-flow'
    | 'invalid-rule';
  message: string;
  machineId?: string;
  resource?: string;
}

export type TileDesignInputResult =
  | { kind: 'valid'; input: TileDesignInput }
  | InvalidTileDesignInput;
