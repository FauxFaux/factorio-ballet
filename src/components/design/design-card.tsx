import './design-card.css';
import type { CellEntry } from '../../cell.ts';
import type { FactoryDesign } from '../../design.ts';
import { DesignColumn } from './design-column.tsx';

/** A single kernel-design workspace, with room for its controls and future layout editor. */
export function DesignCard({
  index,
  design,
  onDesignChange,
}: {
  index: number;
  design: FactoryDesign;
  onDesignChange: (update: (design: FactoryDesign) => FactoryDesign) => void;
}) {
  const title = `Design ${index + 1}`;

  return (
    <article class="design-card" aria-labelledby={`design-card-title-${index}`}>
      <aside class="design-card-controls" aria-label={`${title} controls`}>
        <h3 id={`design-card-title-${index}`}>{title}</h3>
        <div class="design-card-control-space">
          <p>Controls</p>
        </div>
      </aside>
      <div class="design-card-grid">
        <DesignColumn
          index={0}
          column={design.columns[0]}
          entries={emptyEntries}
          counts={emptyCounts}
          progress={0}
          onChange={(update) =>
            onDesignChange((previous) => ({
              ...previous,
              columns: [update(previous.columns[0]), ...previous.columns.slice(1)],
            }))
          }
        />
      </div>
    </article>
  );
}

const emptyEntries: CellEntry[] = [];
const emptyCounts: (number | undefined)[] = [];
