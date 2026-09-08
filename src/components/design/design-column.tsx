import './design-column.css';
import { ArrowRightIcon, ChevronRightIcon, TrashIcon } from '@primer/octicons-react';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CellEntry } from '../../cell.ts';
import { staticData } from '../../data/index.ts';
import type {
  DesignColumn as DesignColumnData,
  DesignDirection,
  DesignPosition,
} from '../../design.ts';
import {
  beltItemTraces,
  beltLoopEntityIndexes,
  paintBelts,
  straightBeltPath,
  type BeltDrag,
} from './design-belts.ts';
import {
  Assembler,
  Belt,
  entityPositionStatuses,
  Inserter,
  TILE_SIZE,
  type ViewportPoint,
} from './design-entities.tsx';
import { RecipeButton } from './recipe-button.tsx';

type CursorMode = 'pan' | 'belt' | 'inserter' | 'erase';
type PanDrag = { pointerId: number; x: number; y: number };
type AssemblerDrag = {
  pointerId: number;
  x: number;
  y: number;
  position: DesignPosition;
};

const clockwiseDirection: Record<DesignDirection, DesignDirection> = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north',
};

export {
  entityPositionStatuses,
  worldToViewport,
  type EntityPositionStatus,
} from './design-entities.tsx';
export { beltLoopEntityIndexes } from './design-belts.ts';
export { assemblerInputStatuses } from './design-belts.ts';
export type { AssemblerInputStatus } from './design-belts.ts';
export { analyzeDesignLanes, singleLaneItem } from './design-lanes.ts';
export type {
  DesignLaneAnalysis,
  DesignLaneIssue,
  LaneContents,
  LaneInjection,
} from './design-lanes.ts';

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
  const hoveredEntityIndex = useRef<number>();
  const inserterDirection = useRef<DesignDirection>('east');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState<ViewportPoint>({ x: 0, y: 0 });
  const [cursorMode, setCursorMode] = useState<CursorMode>('pan');
  const entityStatuses = entityPositionStatuses(column.entities);
  const loopBeltIndexes = beltLoopEntityIndexes(column.entities);
  const itemTracesByBelt = beltItemTraces(column, staticData.recipes);

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

  const placeInserter = (position: DesignPosition) => {
    onChange((current) => ({
      ...current,
      entities: [
        ...current.entities,
        { kind: 'inserter', position, direction: inserterDirection.current },
      ],
    }));
  };

  const rotateEntity = (entityIndex: number) => {
    onChange((current) => {
      const entity = current.entities[entityIndex];
      if (!entity || !('direction' in entity)) return current;
      const direction = clockwiseDirection[entity.direction];
      if (entity.kind === 'inserter') inserterDirection.current = direction;
      return {
        ...current,
        entities: current.entities.map((currentEntity, currentIndex) =>
          currentIndex === entityIndex ? { ...currentEntity, direction } : currentEntity,
        ),
      };
    });
  };

  useEffect(() => {
    const rotateHoveredEntity = (event: KeyboardEvent) => {
      if (!['r', 'p'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
      const entityIndex = hoveredEntityIndex.current;
      if (entityIndex === undefined) return;
      event.preventDefault();
      rotateEntity(entityIndex);
    };

    window.addEventListener('keydown', rotateHoveredEntity);
    return () => window.removeEventListener('keydown', rotateHoveredEntity);
  });

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
          if (cursorMode === 'inserter') {
            placeInserter(viewportToWorld(event));
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
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                eraseEntity(entityIndex);
              }}
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
              onPointerEnter={() => {
                hoveredEntityIndex.current = entityIndex;
              }}
              onPointerLeave={() => {
                if (hoveredEntityIndex.current === entityIndex)
                  hoveredEntityIndex.current = undefined;
              }}
            />
          ) : entity.kind === 'belt' ? (
            <Belt
              key={entityIndex}
              belt={entity}
              status={entityStatuses[entityIndex]}
              hasLoop={loopBeltIndexes.has(entityIndex)}
              itemTraces={itemTracesByBelt.get(entityIndex) ?? []}
              worldOrigin={worldOrigin}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                eraseEntity(entityIndex);
              }}
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
              onPointerEnter={() => {
                hoveredEntityIndex.current = entityIndex;
              }}
              onPointerLeave={() => {
                if (hoveredEntityIndex.current === entityIndex)
                  hoveredEntityIndex.current = undefined;
              }}
            />
          ) : entity.kind === 'inserter' ? (
            <Inserter
              key={entityIndex}
              inserter={entity}
              status={entityStatuses[entityIndex]}
              worldOrigin={worldOrigin}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                eraseEntity(entityIndex);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                if (cursorMode === 'erase') {
                  eraseEntity(entityIndex);
                  return;
                }
                if (cursorMode === 'inserter') rotateEntity(entityIndex);
              }}
              onPointerMove={(event) => {
                if (cursorMode !== 'erase' || (event.buttons & 1) === 0) return;
                event.stopPropagation();
                eraseEntity(entityIndex);
              }}
              onPointerEnter={() => {
                hoveredEntityIndex.current = entityIndex;
              }}
              onPointerLeave={() => {
                if (hoveredEntityIndex.current === entityIndex)
                  hoveredEntityIndex.current = undefined;
              }}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}
