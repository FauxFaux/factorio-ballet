import './design-column.css';
import { TrashIcon } from '@primer/octicons-react';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CellEntry } from '../../cell.ts';
import { recipeName, staticData } from '../../data/index.ts';
import type {
  DesignAssembler,
  DesignColumn as DesignColumnData,
  DesignEntity,
  DesignPosition,
} from '../../design.ts';
import { iconStyle, recipeIconStyle } from '../icon.tsx';
import { RecipeButton } from './recipe-button.tsx';

const TILE_SIZE = 12;

type ViewportPoint = { x: number; y: number };
type CursorMode = 'pan' | 'erase';
type PanDrag = { pointerId: number; x: number; y: number };
type AssemblerDrag = {
  pointerId: number;
  x: number;
  y: number;
  position: DesignPosition;
};

/** The placement and connection validity currently known for an entity. */
export type EntityPositionStatus = 'valid' | 'overlap' | 'disconnected';

interface EntityBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Return each entity's placement status. Connection validation will later be able to return
 * `disconnected`; for now, only intersecting tile rectangles are invalid.
 */
export function entityPositionStatuses(entities: DesignEntity[]): EntityPositionStatus[] {
  const statuses: EntityPositionStatus[] = Array(entities.length).fill('valid');
  const bounds = entities.map(entityBounds);

  for (let first = 0; first < bounds.length; first += 1) {
    for (let second = first + 1; second < bounds.length; second += 1) {
      if (!rectanglesOverlap(bounds[first], bounds[second])) continue;
      statuses[first] = 'overlap';
      statuses[second] = 'overlap';
    }
  }

  return statuses;
}

function entityBounds(entity: DesignEntity): EntityBounds {
  return {
    ...entity.position,
    ...(entity.kind === 'assembler' ? entity.size : { width: 1, height: 1 }),
  };
}

function rectanglesOverlap(first: EntityBounds, second: EntityBounds): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

/** Convert a position in the design model to a pixel position in the visible viewport. */
export function worldToViewport(
  position: DesignPosition,
  worldOrigin: ViewportPoint,
): ViewportPoint {
  return {
    x: worldOrigin.x + position.x * TILE_SIZE,
    y: worldOrigin.y + position.y * TILE_SIZE,
  };
}

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
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<PanDrag>();
  const assemblerDrag = useRef<AssemblerDrag>();
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState<ViewportPoint>({ x: 0, y: 0 });
  const [cursorMode, setCursorMode] = useState<CursorMode>('pan');
  const entityStatuses = entityPositionStatuses(column.entities);

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

  const moveAssembler = (entityIndex: number, event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const previous = assemblerDrag.current;
    if (!previous || previous.pointerId !== event.pointerId) return;

    const position = {
      x: previous.position.x + Math.round((event.clientX - previous.x) / TILE_SIZE),
      y: previous.position.y + Math.round((event.clientY - previous.y) / TILE_SIZE),
    };
    onChange((current) => {
      const entity = current.entities[entityIndex];
      if (
        !entity ||
        entity.kind !== 'assembler' ||
        (entity.position.x === position.x && entity.position.y === position.y)
      ) {
        return current;
      }
      return {
        ...current,
        entities: current.entities.map((currentEntity, currentIndex) =>
          currentIndex === entityIndex ? { ...currentEntity, position } : currentEntity,
        ),
      };
    });
  };

  const eraseEntity = (entityIndex: number) => {
    onChange((current) => ({
      ...current,
      entities: current.entities.filter((_, currentIndex) => currentIndex !== entityIndex),
    }));
  };

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
        class={`cell-design-viewport${cursorMode === 'erase' ? ' cell-design-viewport-erase' : ''}`}
        role="region"
        aria-label={`Design viewport for column ${index + 1}`}
        style={{ backgroundPosition: `${worldOrigin.x}px ${worldOrigin.y}px` }}
        onPointerDown={(event) => {
          if (cursorMode === 'erase') return;
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (!previous || previous.pointerId !== event.pointerId) return;
          setPan((current) => ({
            x: current.x + event.clientX - previous.x,
            y: current.y + event.clientY - previous.y,
          }));
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
        onWheel={(event) => {
          event.preventDefault();
          setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
        }}
      >
        {column.entities.map((entity, entityIndex) =>
          entity.kind === 'assembler' ? (
            <Assembler
              key={entityIndex}
              assembler={entity}
              status={entityStatuses[entityIndex]}
              worldOrigin={worldOrigin}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                if (cursorMode === 'erase') {
                  eraseEntity(entityIndex);
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                assemblerDrag.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  position: entity.position,
                };
              }}
              onPointerMove={(event) => {
                event.stopPropagation();
                if (cursorMode === 'erase') {
                  if ((event.buttons & 1) !== 0) eraseEntity(entityIndex);
                  return;
                }
                moveAssembler(entityIndex, event);
              }}
              onPointerUp={(event) => {
                if (assemblerDrag.current?.pointerId !== event.pointerId) return;
                event.stopPropagation();
                assemblerDrag.current = undefined;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                assemblerDrag.current = undefined;
              }}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}

/** An assembler positioned on the design world's tile grid. */
function Assembler({
  assembler,
  status,
  worldOrigin,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLostPointerCapture,
}: {
  assembler: DesignAssembler;
  status: EntityPositionStatus;
  worldOrigin: ViewportPoint;
  onPointerDown: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: () => void;
}) {
  const recipe = staticData.recipes[assembler.recipe];
  const name = recipeName(assembler.recipe);
  const { x, y } = assembler.position;
  const { width, height } = assembler.size;
  const viewportPosition = worldToViewport(assembler.position, worldOrigin);
  const isOverlapping = status === 'overlap';

  return (
    <div
      class={`cell-design-assembler${isOverlapping ? ' cell-design-assembler-error' : ''}`}
      role="img"
      aria-label={`${name} assembler at ${x}, ${y}${isOverlapping ? ', overlaps another entity' : ''}`}
      title={`${name} (${x}, ${y})${isOverlapping ? ' — overlaps another entity' : ''}`}
      data-position={`${x},${y}`}
      data-position-status={status}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onLostPointerCapture={onLostPointerCapture}
      style={{
        left: `${viewportPosition.x}px`,
        top: `${viewportPosition.y}px`,
        width: `${width * TILE_SIZE}px`,
        height: `${height * TILE_SIZE}px`,
      }}
    >
      <span class="cell-design-assembler-icon" aria-hidden="true">
        <span
          class="cell-design-assembler-sprite"
          style={
            recipe
              ? recipeIconStyle(assembler.recipe, recipe)
              : iconStyle(`recipe:${assembler.recipe}`, 'recipe:recipe-unknown')
          }
        />
      </span>
    </div>
  );
}
