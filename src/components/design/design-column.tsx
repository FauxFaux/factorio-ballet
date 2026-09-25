import './design-column.css';
import { ArrowRightIcon, ChevronRightIcon, TrashIcon } from '@primer/octicons-react';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { entryMachine, entryRecipe, type CellEntry } from '../../cell.ts';
import type { DesignColumn as DesignColumnData } from '../../compute/design.ts';
import { useDataset } from '../../dataset/context.tsx';
import { TILE_SIZE, type ViewportPoint } from './design-entities.tsx';
import { type CursorMode, useDesignInteractions } from './design-interactions.ts';
import { DesignScene } from './design-scene.tsx';
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
  const { data } = useDataset();
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState<ViewportPoint>({ x: 0, y: 0 });
  const [cursorMode, setCursorMode] = useState<CursorMode>('pan');

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setViewportSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const worldOrigin = {
    x: Math.round(viewportSize.width / 2 + pan.x),
    y: Math.round(viewportSize.height / 2 + pan.y),
  };
  const interactions = useDesignInteractions({
    entities: column.entities,
    cursorMode,
    worldOrigin,
    setPan,
    onChange,
  });
  const machinesByRecipe = Object.fromEntries(
    entries.flatMap((entry) => {
      const recipe = entryRecipe(entry);
      const machine = recipe ? entryMachine(entry, recipe, progress) : undefined;
      return machine ? ([[entry.recipe, data.machines[machine]]] as const) : [];
    }),
  );
  const recipes = Object.fromEntries(
    column.entities.flatMap((entity) => {
      if (entity.kind !== 'assembler') return [];
      const recipe = data.recipes[entity.recipe];
      return recipe ? ([[entity.recipe, recipe]] as const) : [];
    }),
  );

  return (
    <section
      class="cell-design-column"
      data-entity-count={column.entities.length}
      style={{ '--cell-design-tile-size': `${TILE_SIZE}px` }}
    >
      <div class="cell-design-toolbar">
        <h3>Column {index + 1}</h3>
        <button
          type="button"
          class="cell-design-belt-mode"
          aria-label="Draw belts"
          aria-pressed={cursorMode === 'belt'}
          title="Draw transport belts"
          onClick={() => setCursorMode((mode) => (mode === 'belt' ? 'pan' : 'belt'))}
        >
          <ChevronRightIcon aria-hidden="true" />
        </button>
        <button
          type="button"
          class="cell-design-inserter-mode"
          aria-label="Place inserters"
          aria-pressed={cursorMode === 'inserter'}
          title="Place inserters"
          onClick={() => setCursorMode((mode) => (mode === 'inserter' ? 'pan' : 'inserter'))}
        >
          <ArrowRightIcon aria-hidden="true" />
        </button>
        <button
          type="button"
          class="cell-design-erase"
          aria-label="Erase"
          aria-pressed={cursorMode === 'erase'}
          title="Erase entities"
          onClick={() => setCursorMode((mode) => (mode === 'erase' ? 'pan' : 'erase'))}
        >
          <TrashIcon aria-hidden="true" />
        </button>
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
      <div
        ref={viewport}
        class={`cell-design-viewport${cursorMode === 'erase' ? ' cell-design-viewport-erase' : ''}${cursorMode === 'belt' ? ' cell-design-viewport-belt' : ''}${cursorMode === 'inserter' ? ' cell-design-viewport-inserter' : ''}`}
        role="region"
        aria-label={`Design viewport for column ${index + 1}`}
        style={{ backgroundPosition: `${worldOrigin.x}px ${worldOrigin.y}px` }}
        {...interactions}
        onWheel={(event) => {
          event.preventDefault();
          setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
        }}
      >
        <DesignScene
          column={column}
          worldOrigin={worldOrigin}
          recipes={recipes}
          machinesByRecipe={machinesByRecipe}
          onEntityEnter={interactions.onEntityEnter}
          onEntityLeave={interactions.onEntityLeave}
        />
      </div>
    </section>
  );
}
