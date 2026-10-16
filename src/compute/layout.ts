import type { DesignDirection } from './design.ts';
import type { Position } from '../bp/decode.ts';

/** Frozen module positions, keyed by the module's stable recipe/copy ID. */
export type FrozenModulePositions = Record<string, Position>;

/** Persisted state for a cell's high-level factory-layout surface. */
export interface CellLayout {
  /** Absent selects the original rail/module layout. */
  type?: 'bobs';
  frozenModules?: FrozenModulePositions;
  moduleRotations?: Record<string, DesignDirection>;
}

/** Start an empty layout surface for a cell. */
export function newCellLayout(type?: CellLayout['type']): CellLayout {
  return type ? { type } : {};
}
