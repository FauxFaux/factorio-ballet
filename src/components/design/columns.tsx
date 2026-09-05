import './columns.css';
import { DesignColumn } from './design-column.tsx';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FactoryDesign } from '../../design.ts';
import type { Setter } from '../../ts.ts';

/** A cell's construction area, with one persisted blueprint for each created column. */
export function CellDesign({
  design,
  setDesign,
}: {
  design: FactoryDesign;
  setDesign: Setter<FactoryDesign>;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    if (!design.columns) return;

    const updateColumnCount = () => {
      const nextCount = Math.max(1, Math.floor((element.clientWidth + 8) / (600 + 8)));
      setColumnCount(nextCount);
      setDesign((previous) => {
        const missing = nextCount - previous.columns.length;
        return missing > 0
          ? {
              ...previous,
              columns: [
                ...previous.columns,
                ...Array.from({ length: missing }, () => ({ entities: [] })),
              ],
            }
          : previous;
      });
    };

    updateColumnCount();
    if (!('ResizeObserver' in globalThis)) return;
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section class="cell-design" aria-label="Design">
      <div
        ref={surface}
        class="cell-design-surface"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {design.columns.map((column, index) => (
          <DesignColumn key={index} index={index} column={column} />
        ))}
      </div>
    </section>
  );
}
