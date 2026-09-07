import './design-column.css';
import { ArrowRightIcon, TrashIcon } from '@primer/octicons-react';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CellEntry } from '../../cell.ts';
import type {
  DesignColumn as DesignColumnData,
  DesignDirection,
  DesignPosition,
} from '../../design.ts';
import {
  Assembler,
  Belt,
  entityPositionStatuses,
  TILE_SIZE,
  type ViewportPoint,
} from './design-entities.tsx';
import { RecipeButton } from './recipe-button.tsx';

type CursorMode = 'pan' | 'belt' | 'erase';
type PanDrag = { pointerId: number; x: number; y: number };
type BeltAxis = 'horizontal' | 'vertical';
type BeltDrag = { pointerId: number; position: DesignPosition; axis?: BeltAxis };
type AssemblerDrag = {
  pointerId: number;
  x: number;
  y: number;
  position: DesignPosition;
};

export {
  entityPositionStatuses,
  worldToViewport,
  type EntityPositionStatus,
} from './design-entities.tsx';

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
  const beltDrag = useRef<BeltDrag>();
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

  const viewportToWorld = (event: JSX.TargetedPointerEvent<HTMLDivElement>): DesignPosition => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - bounds.left - worldOrigin.x) / TILE_SIZE),
      y: Math.floor((event.clientY - bounds.top - worldOrigin.y) / TILE_SIZE),
    };
  };

  const extendBeltDrag = (pointerId: number, position: DesignPosition) => {
    const previous = beltDrag.current;
    if (!previous || previous.pointerId !== pointerId) return;
    const next = straightBeltPath(previous, position);
    const { positions } = next;
    if (positions.length === 0) return;
    onChange((current) => paintBelts(current, previous.position, positions));
    beltDrag.current = { pointerId, position: next.position, axis: next.axis };
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
          class="cell-design-belt-mode"
          aria-label="Draw belts"
          aria-pressed={cursorMode === 'belt'}
          title="Draw transport belts"
          onClick={() => setCursorMode((mode) => (mode === 'belt' ? 'pan' : 'belt'))}
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
        class={`cell-design-viewport${cursorMode === 'erase' ? ' cell-design-viewport-erase' : ''}${cursorMode === 'belt' ? ' cell-design-viewport-belt' : ''}`}
        role="region"
        aria-label={`Design viewport for column ${index + 1}`}
        style={{ backgroundPosition: `${worldOrigin.x}px ${worldOrigin.y}px` }}
        onPointerDown={(event) => {
          if (cursorMode === 'erase') return;
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          if (cursorMode === 'belt') {
            beltDrag.current = {
              pointerId: event.pointerId,
              position: viewportToWorld(event),
            };
            return;
          }
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          if (cursorMode === 'belt') {
            extendBeltDrag(event.pointerId, viewportToWorld(event));
            return;
          }
          const previous = drag.current;
          if (!previous || previous.pointerId !== event.pointerId) return;
          setPan((current) => ({
            x: current.x + event.clientX - previous.x,
            y: current.y + event.clientY - previous.y,
          }));
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          if (beltDrag.current?.pointerId === event.pointerId) {
            extendBeltDrag(event.pointerId, viewportToWorld(event));
            beltDrag.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
          beltDrag.current = undefined;
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
          ) : entity.kind === 'belt' ? (
            <Belt
              key={entityIndex}
              belt={entity}
              status={entityStatuses[entityIndex]}
              worldOrigin={worldOrigin}
              onPointerDown={(event) => {
                if (event.button !== 0 || cursorMode !== 'erase') return;
                event.stopPropagation();
                eraseEntity(entityIndex);
              }}
              onPointerMove={(event) => {
                if (cursorMode !== 'erase' || (event.buttons & 1) === 0) return;
                event.stopPropagation();
                eraseEntity(entityIndex);
              }}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}

function directionBetween(first: DesignPosition, second: DesignPosition): DesignDirection {
  if (second.x > first.x) return 'east';
  if (second.x < first.x) return 'west';
  if (second.y > first.y) return 'south';
  return 'north';
}

/** Return an unbroken cardinal path, even when pointer events skip over tiles. */
function cardinalPath(from: DesignPosition, to: DesignPosition): DesignPosition[] {
  const path: DesignPosition[] = [];
  let current = from;
  while (current.x !== to.x || current.y !== to.y) {
    const dx = to.x - current.x;
    const dy = to.y - current.y;
    current =
      Math.abs(dx) >= Math.abs(dy)
        ? { x: current.x + Math.sign(dx), y: current.y }
        : { x: current.x, y: current.y + Math.sign(dy) };
    path.push(current);
  }
  return path;
}

/**
 * Keep the current belt run straight until the pointer has clearly moved away
 * from it. This makes small perpendicular pointer wobble harmless while
 * dragging a long row or column of belts.
 */
function straightBeltPath(
  drag: BeltDrag,
  to: DesignPosition,
): { axis: BeltAxis; position: DesignPosition; positions: DesignPosition[] } {
  const axis =
    drag.axis ??
    (Math.abs(to.x - drag.position.x) >= Math.abs(to.y - drag.position.y)
      ? 'horizontal'
      : 'vertical');
  const offTrack =
    axis === 'horizontal' ? Math.abs(to.y - drag.position.y) : Math.abs(to.x - drag.position.x);
  const onTrack =
    axis === 'horizontal' ? { x: to.x, y: drag.position.y } : { x: drag.position.x, y: to.y };

  if (offTrack < 3) {
    return { axis, position: onTrack, positions: cardinalPath(drag.position, onTrack) };
  }

  return {
    axis: axis === 'horizontal' ? 'vertical' : 'horizontal',
    position: to,
    positions: [...cardinalPath(drag.position, onTrack), ...cardinalPath(onTrack, to)],
  };
}

function paintBelts(
  column: DesignColumnData,
  start: DesignPosition,
  positions: DesignPosition[],
): DesignColumnData {
  const entities = [...column.entities];
  let previous = start;

  for (const position of positions) {
    const direction = directionBetween(previous, position);
    setBelt(entities, previous, direction);
    setBelt(entities, position, direction);
    previous = position;
  }
  return { ...column, entities };
}

function setBelt(
  entities: DesignColumnData['entities'],
  position: DesignPosition,
  direction: DesignDirection,
) {
  const index = entities.findIndex(
    (entity) =>
      entity.kind === 'belt' &&
      entity.position.x === position.x &&
      entity.position.y === position.y,
  );
  const belt = { kind: 'belt' as const, position, direction };
  if (index === -1) entities.push(belt);
  else entities[index] = belt;
}
