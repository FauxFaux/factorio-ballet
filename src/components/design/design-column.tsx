import './design-column.css';
import type { DesignColumn as DesignColumnData } from '../../design.ts';

export function DesignColumn({ index, column }: { index: number; column: DesignColumnData }) {
  return (
    <section class="cell-design-column" data-entity-count={column.entities.length}>
      <h3>Column {index + 1}</h3>
    </section>
  );
}
