import './design-column.css';
import type { CellEntry } from '../../cell.ts';
import { recipeName, staticData } from '../../data/index.ts';
import type { DesignAssembler, DesignColumn as DesignColumnData } from '../../design.ts';
import { iconStyle, recipeIconStyle } from '../icon.tsx';
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
      <div class="cell-design-toolbar">
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
      </div>
      <div class="cell-design-viewport">
        <div class="cell-design-world">
          {column.entities.map((entity, entityIndex) =>
            entity.kind === 'assembler' ? <Assembler key={entityIndex} assembler={entity} /> : null,
          )}
        </div>
      </div>
    </section>
  );
}

/** An assembler positioned on the design world's tile grid. */
function Assembler({ assembler }: { assembler: DesignAssembler }) {
  const recipe = staticData.recipes[assembler.recipe];
  const name = recipeName(assembler.recipe);
  const { x, y } = assembler.position;
  const { width, height } = assembler.size;

  return (
    <div
      class="cell-design-assembler"
      role="img"
      aria-label={`${name} assembler at ${x}, ${y}`}
      title={`${name} (${x}, ${y})`}
      data-position={`${x},${y}`}
      style={{
        gridColumn: `${x + 1} / span ${width}`,
        gridRow: `${y + 1} / span ${height}`,
      }}
    >
      <span
        class="cell-design-assembler-icon"
        style={
          recipe
            ? recipeIconStyle(assembler.recipe, recipe)
            : iconStyle(`recipe:${assembler.recipe}`, 'recipe:recipe-unknown')
        }
        aria-hidden="true"
      />
    </div>
  );
}
