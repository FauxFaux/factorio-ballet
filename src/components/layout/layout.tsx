import './layout.css';
import type { CellLayout } from '../../layout.ts';

/** The initial, intentionally empty surface for a cell's factory layout. */
export function CellLayoutSurface({ layout: _layout }: { layout: CellLayout }) {
  return <section class="cell-layout" aria-label="Layout" />;
}
