import { entryMachine, entryRecipe, type CellEntry } from '../../cell.ts';
import { recipeName, staticData } from '../../data/index.ts';
import type { DesignAssembler, DesignColumn, DesignEntity, DesignPosition } from '../../design.ts';
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
      <span class="cell-design-recipe-icon" aria-hidden="true">
        <span
          class="cell-design-recipe-icon-sprite"
          style={recipe ? recipeIconStyle(entry.recipe, recipe) : undefined}
        />
      </span>
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
  const retained = matching.slice(0, count).map((assembler) => ({ ...assembler, size }));
  const occupied = [
    ...column.entities.filter((entity) => entity.kind !== 'assembler' || entity.recipe !== recipe),
    ...retained,
  ].map(entityBounds);
  const assemblers = Array.from({ length: count }, (_, index) => {
    const existing = matching[index];
    if (existing) return { ...existing, size };
    const position = nearestFreePosition(size, occupied);
    const assembler: DesignAssembler = { kind: 'assembler', recipe, size, position };
    occupied.push(entityBounds(assembler));
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

interface DesignBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounds for placement; non-assemblers currently occupy one tile. */
function entityBounds(entity: DesignEntity): DesignBounds {
  return {
    ...entity.position,
    ...(entity.kind === 'assembler' ? entity.size : { width: 1, height: 1 }),
  };
}

/**
 * Find the first vacant position in increasing Manhattan distance from the world's origin.
 * Coordinates may be negative; within a ring, prefer the column's natural top-to-bottom
 * arrangement.
 */
function nearestFreePosition(
  size: DesignAssembler['size'],
  occupied: DesignBounds[],
): DesignPosition {
  for (let distance = 0; ; distance += 1) {
    for (let y = -distance; y <= distance; y += 1) {
      const xDistance = distance - Math.abs(y);
      for (const x of xDistance === 0 ? [0] : [-xDistance, xDistance]) {
        const position = { x, y };
        const candidate = { ...position, ...size };
        if (!occupied.some((entity) => rectanglesOverlap(candidate, entity))) return position;
      }
    }
  }
}

function rectanglesOverlap(first: DesignBounds, second: DesignBounds): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}
