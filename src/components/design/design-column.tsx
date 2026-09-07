import './design-column.css';
import type { CellEntry } from '../../cell.ts';
import type { DesignColumn as DesignColumnData } from '../../design.ts';
import { RecipeButton } from './recipe-button.tsx';

/** The controls which bring this blueprint column in line with the cell's solved recipe rows. */
export function DesignColumn({
  index,
  column,
  entries,
  counts,
  progress,
  onChange,
}: {
  index: number;
  column: DesignColumnData;
  entries: CellEntry[];
  counts: (number | undefined)[];
  progress: number;
  onChange: (update: (column: DesignColumnData) => DesignColumnData) => void;
}) {
  return (
    <section class="cell-design-column" data-entity-count={column.entities.length}>
      <h3>Column {index + 1}</h3>
      <div class="cell-design-recipes" aria-label={`Recipes for column ${index + 1}`}>
        {entries.map((entry, entryIndex) => (
          <RecipeButton
            key={entry.recipe}
            entry={entry}
            count={counts[entryIndex]}
            column={column}
            progress={progress}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}
