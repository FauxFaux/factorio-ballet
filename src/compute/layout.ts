import type { Position } from '../bp/decode.ts';

/** Frozen module positions, keyed by the module's stable recipe/copy ID. */
export type FrozenModulePositions = Record<string, Position>;

/** Persisted state for a cell's high-level factory-layout surface. */
export interface CellLayout {
  frozenModules?: FrozenModulePositions;
}

/** Start an empty layout surface for a cell. */
export function newCellLayout(): CellLayout {
  return {};
}
