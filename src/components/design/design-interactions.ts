import type { JSX } from 'preact';
import { useEffect, useRef, type Dispatch, type StateUpdater } from 'preact/hooks';
import type { DesignColumn, DesignDirection, DesignEntity, DesignPosition } from '../../design.ts';
import { paintBelts, straightBeltPath, type BeltDrag } from './design-belts.ts';
import { TILE_SIZE, type ViewportPoint } from './design-entities.tsx';

export type CursorMode = 'pan' | 'belt' | 'inserter' | 'erase';

type PanDrag = { pointerId: number; x: number; y: number };
type AssemblerDrag = PanDrag & { entityIndex: number; position: DesignPosition };
type PointerEvent = JSX.TargetedPointerEvent<HTMLDivElement>;
type MouseEvent = JSX.TargetedMouseEvent<HTMLDivElement>;

const clockwiseDirection: Record<DesignDirection, DesignDirection> = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north',
};

interface DesignInteractionsOptions {
  entities: DesignEntity[];
  cursorMode: CursorMode;
  worldOrigin: ViewportPoint;
  setPan: Dispatch<StateUpdater<ViewportPoint>>;
  onChange: (update: (column: DesignColumn) => DesignColumn) => void;
}

/** Own the viewport's pointer gestures and editing state. */
export function useDesignInteractions({
  entities,
  cursorMode,
  worldOrigin,
  setPan,
  onChange,
}: DesignInteractionsOptions) {
  const panDrag = useRef<PanDrag>();
  const beltDrag = useRef<BeltDrag>();
  const assemblerDrag = useRef<AssemblerDrag>();
  const hoveredEntityIndex = useRef<number>();
  const inserterDirection = useRef<DesignDirection>('east');

  const eraseEntity = (entityIndex: number) => {
    onChange((column) => ({
      ...column,
      entities: column.entities.filter((_, index) => index !== entityIndex),
    }));
  };

  const rotateEntity = (entityIndex: number) => {
    onChange((column) => {
      const entity = column.entities[entityIndex];
      if (!entity || !('direction' in entity)) return column;
      const direction = clockwiseDirection[entity.direction];
      if (entity.kind === 'inserter') inserterDirection.current = direction;
      return replaceEntity(column, entityIndex, { ...entity, direction });
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

  const extendBeltDrag = (event: PointerEvent) => {
    const previous = beltDrag.current;
    if (!previous || previous.pointerId !== event.pointerId) return;
    const next = straightBeltPath(previous, viewportToWorld(event, worldOrigin));
    if (next.positions.length === 0) return;
    onChange((column) => paintBelts(column, previous.position, next.positions));
    beltDrag.current = { pointerId: event.pointerId, position: next.position, axis: next.axis };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const entityIndex = entityIndexFromEvent(event);
    const entity = entityIndex === undefined ? undefined : entities[entityIndex];

    if (entity && entityIndex !== undefined) {
      if (cursorMode === 'erase') {
        event.stopPropagation();
        eraseEntity(entityIndex);
        return;
      }
      if (entity.kind === 'assembler') {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        assemblerDrag.current = {
          pointerId: event.pointerId,
          entityIndex,
          x: event.clientX,
          y: event.clientY,
          position: entity.position,
        };
        return;
      }
      if (entity.kind === 'inserter') {
        event.stopPropagation();
        if (cursorMode === 'inserter') rotateEntity(entityIndex);
        return;
      }
    }

    if (cursorMode === 'erase') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (cursorMode === 'belt') {
      beltDrag.current = {
        pointerId: event.pointerId,
        position: viewportToWorld(event, worldOrigin),
      };
    } else if (cursorMode === 'inserter') {
      const position = viewportToWorld(event, worldOrigin);
      onChange((column) => ({
        ...column,
        entities: [
          ...column.entities,
          { kind: 'inserter', position, direction: inserterDirection.current },
        ],
      }));
    } else {
      panDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (assemblerDrag.current?.pointerId === event.pointerId) {
      event.stopPropagation();
      moveAssembler(event, assemblerDrag.current, onChange);
      return;
    }
    if (beltDrag.current?.pointerId === event.pointerId) {
      extendBeltDrag(event);
      return;
    }

    const entityIndex = entityIndexFromEvent(event);
    if (entityIndex !== undefined) {
      if (cursorMode === 'erase' && (event.buttons & 1) !== 0) {
        event.stopPropagation();
        eraseEntity(entityIndex);
        return;
      }
    }
    const previous = panDrag.current;
    if (!previous || previous.pointerId !== event.pointerId) return;
    setPan((pan) => ({
      x: pan.x + event.clientX - previous.x,
      y: pan.y + event.clientY - previous.y,
    }));
    panDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: PointerEvent) => {
    if (assemblerDrag.current?.pointerId === event.pointerId) {
      assemblerDrag.current = undefined;
      event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (beltDrag.current?.pointerId === event.pointerId) {
      extendBeltDrag(event);
      beltDrag.current = undefined;
    } else if (panDrag.current?.pointerId === event.pointerId) {
      panDrag.current = undefined;
    } else {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onContextMenu = (event: MouseEvent) => {
    const entityIndex = entityIndexFromEvent(event);
    if (entityIndex === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    eraseEntity(entityIndex);
  };

  return {
    onContextMenu,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onEntityEnter: (entityIndex: number) => {
      hoveredEntityIndex.current = entityIndex;
    },
    onEntityLeave: (entityIndex: number) => {
      if (hoveredEntityIndex.current === entityIndex) hoveredEntityIndex.current = undefined;
    },
    onLostPointerCapture: () => {
      panDrag.current = undefined;
      beltDrag.current = undefined;
      assemblerDrag.current = undefined;
    },
  };
}

function viewportToWorld(event: PointerEvent, worldOrigin: ViewportPoint): DesignPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.floor((event.clientX - bounds.left - worldOrigin.x) / TILE_SIZE),
    y: Math.floor((event.clientY - bounds.top - worldOrigin.y) / TILE_SIZE),
  };
}

function entityElementFromEvent(event: PointerEvent | MouseEvent): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest('[data-entity-index]') : null;
}

function entityIndexFromEvent(event: PointerEvent | MouseEvent): number | undefined {
  const value = entityElementFromEvent(event)?.dataset.entityIndex;
  if (value === undefined) return undefined;
  const index = Number(value);
  return Number.isInteger(index) ? index : undefined;
}

function replaceEntity(column: DesignColumn, index: number, entity: DesignEntity): DesignColumn {
  return {
    ...column,
    entities: column.entities.map((current, currentIndex) =>
      currentIndex === index ? entity : current,
    ),
  };
}

function moveAssembler(
  event: PointerEvent,
  drag: AssemblerDrag | undefined,
  onChange: DesignInteractionsOptions['onChange'],
) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const position = {
    x: drag.position.x + Math.round((event.clientX - drag.x) / TILE_SIZE),
    y: drag.position.y + Math.round((event.clientY - drag.y) / TILE_SIZE),
  };
  onChange((column) => {
    const entity = column.entities[drag.entityIndex];
    if (
      !entity ||
      entity.kind !== 'assembler' ||
      (entity.position.x === position.x && entity.position.y === position.y)
    ) {
      return column;
    }
    return replaceEntity(column, drag.entityIndex, { ...entity, position });
  });
}
