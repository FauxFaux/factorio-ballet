import './design-column.css';

export function DesignColumn({ index }: { index: number }) {
  return (
    <section class="cell-design-column">
      <h3>Column {index + 1}</h3>
    </section>
  );
}
