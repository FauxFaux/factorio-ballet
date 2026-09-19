/**
 * The reserved surface for a cell's high-level factory layout. Its empty object is intentional:
 * later layout tools can add their state without changing whether a cell has a layout at all.
 */
export type CellLayout = object;

/** Start an empty layout surface for a cell. */
export function newCellLayout(): CellLayout {
  return {};
}
