import './columns.css';
import { DesignColumn } from './design-column.tsx';
import { useEffect, useRef, useState } from 'preact/hooks';

/** A cell's blank construction area, ready for future factory-design content. */
export function CellDesign() {
  const surface = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;

    const updateColumnCount = () => {
      setColumnCount(Math.max(1, Math.floor((element.clientWidth + 8) / (600 + 8))));
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
        {Array.from({ length: columnCount }, (_, index) => (
          <DesignColumn key={index} index={index} />
        ))}
      </div>
    </section>
  );
}
