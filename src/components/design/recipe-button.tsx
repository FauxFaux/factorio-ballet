import { entryMachine, entryRecipe, type CellEntry } from '../../cell.ts';
import { recipeName, staticData } from '../../data/index.ts';
import type { DesignAssembler, DesignColumn } from '../../design.ts';
import { recipeIconStyle } from '../icon.tsx';

/** A solved recipe's assembler-count control within a design column. */
export function RecipeButton({
  entry,
  count,
  column,
  progress,
  onChange,
}: {
  entry: CellEntry;
  count: number | undefined;
  column: DesignColumn;
  progress: number;
  onChange: (update: (column: DesignColumn) => DesignColumn) => void;
}) {
  const recipe = entryRecipe(entry);
  const machineId = recipe ? entryMachine(entry, recipe, progress) : undefined;
  const machine = machineId ? staticData.machines[machineId] : undefined;
  const target =
    count !== undefined && Number.isFinite(count) && count >= 0 ? Math.ceil(count) : undefined;
  const current = column.entities.filter(
    (entity): entity is DesignAssembler =>
      entity.kind === 'assembler' && entity.recipe === entry.recipe,
  );
  const disabled = target === undefined || !machine || current.length === target;
  const name = recipeName(entry.recipe);

  return (
    <button
      type="button"
      class="cell-design-recipe"
      disabled={disabled}
      title={
        target === undefined
          ? 'The cell has not worked out this recipe’s assembler count yet'
          : `Set this column to ${target} ${name} assembler${target === 1 ? '' : 's'}`
      }
      aria-label={
        target === undefined
          ? `${name} assembler count not worked out`
          : `Set ${name} assemblers to ${target}`
      }
      onClick={() => {
        if (target === undefined || !machine) return;
        onChange((previous) => reconcileAssemblers(previous, entry.recipe, target, machine.size));
      }}
    >
      <span
        class="cell-design-recipe-icon"
        style={recipe ? recipeIconStyle(entry.recipe, recipe) : undefined}
        aria-hidden="true"
      />
    </button>
  );
}

function reconcileAssemblers(
  column: DesignColumn,
  recipe: string,
  count: number,
  size: DesignAssembler['size'],
): DesignColumn {
  const matching = column.entities.filter(
    (entity): entity is DesignAssembler => entity.kind === 'assembler' && entity.recipe === recipe,
  );
  let y = Math.max(
    0,
    ...column.entities.map(
      (entity) => entity.position.y + (entity.kind === 'assembler' ? entity.size.height : 1),
    ),
  );
  const assemblers = Array.from({ length: count }, (_, index) => {
    const existing = matching[index];
    if (existing) return { ...existing, size };
    const assembler: DesignAssembler = { kind: 'assembler', recipe, size, position: { x: 0, y } };
    y += size.height;
    return assembler;
  });
  return {
    ...column,
    entities: [
      ...column.entities.filter(
        (entity) => entity.kind !== 'assembler' || entity.recipe !== recipe,
      ),
      ...assemblers,
    ],
  };
}
