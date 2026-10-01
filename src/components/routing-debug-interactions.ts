import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { RoutingDebugEntity, RoutingDebugRectangle } from '../boot/url-handler.tsx';
import { connectionTile } from '../compute/routing/path-search.ts';

export { connectionTile } from '../compute/routing/path-search.ts';

export type RoutingDebugMode = 'normal' | 'source' | 'sink' | 'delete' | 'rectangle';
export interface RoutingDebugPosition {
  x: number;
  y: number;
}

type PointerEvent = JSX.TargetedPointerEvent<SVGSVGElement>;
type Drag = {
  pointerId: number;
  grid: SVGSVGElement;
  origin: RoutingDebugPosition;
  clientX: number;
  clientY: number;
  moved: boolean;
  kind: 'entity' | 'rectangle' | 'rectangle-move';
  rectangleIndex?: number;
  rectangle?: RoutingDebugRectangle;
  width: number;
  height: number;
};

export function containsTile(
  rectangle: RoutingDebugRectangle,
  tile: RoutingDebugPosition,
): boolean {
  return (
    tile.x >= rectangle.x &&
    tile.x < rectangle.x + rectangle.width &&
    tile.y >= rectangle.y &&
    tile.y < rectangle.y + rectangle.height
  );
}

export function connectionIsClear(
  entity: RoutingDebugEntity,
  rectangles: RoutingDebugRectangle[],
): boolean {
  const connection = connectionTile(entity);
  return !rectangles.some((rectangle) => containsTile(rectangle, connection));
}

export function availableEntity(
  entity: RoutingDebugEntity,
  entities: RoutingDebugEntity[],
  rectangles: RoutingDebugRectangle[],
  origin?: RoutingDebugPosition,
): boolean {
  return (
    connectionIsClear(entity, rectangles) &&
    !entities.some(
      (other) =>
        other.x === entity.x &&
        other.y === entity.y &&
        (other.x !== origin?.x || other.y !== origin.y),
    )
  );
}

/** Respect SVG's centered preserveAspectRatio when mapping display pixels to whole tiles. */
export function pointerTile(
  grid: SVGSVGElement,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): RoutingDebugPosition | undefined {
  const bounds = grid.getBoundingClientRect();
  const scale = Math.min(bounds.width / width, bounds.height / height);
  if (scale <= 0) return;
  const left = bounds.left + (bounds.width - width * scale) / 2;
  const top = bounds.top + (bounds.height - height * scale) / 2;
  const x = Math.floor((clientX - left) / scale);
  const y = Math.floor((clientY - top) / scale);
  if (x >= 0 && x < width && y >= 0 && y < height) return { x, y };
}

export function useRoutingDebugInteractions({
  width,
  height,
  mode,
  entities,
  rectangles,
  onClickTile,
  onMoveEntity,
  onAddRectangle,
  onMoveRectangle,
}: {
  width: number;
  height: number;
  mode: RoutingDebugMode;
  entities: RoutingDebugEntity[];
  rectangles: RoutingDebugRectangle[];
  onClickTile: (x: number, y: number) => void;
  onMoveEntity: (origin: RoutingDebugPosition, destination: RoutingDebugPosition) => void;
  onAddRectangle: (rectangle: RoutingDebugRectangle) => void;
  onMoveRectangle: (index: number, rectangle: RoutingDebugRectangle) => void;
}) {
  const drag = useRef<Drag>();
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<{
    kind: Drag['kind'];
    rectangle: RoutingDebugRectangle;
    origin: RoutingDebugPosition;
    valid: boolean;
    rectangleIndex?: number;
  }>();

  const endDrag = () => {
    const current = drag.current;
    drag.current = undefined;
    setPreview(undefined);
    if (current?.grid.hasPointerCapture?.(current.pointerId)) {
      current.grid.releasePointerCapture(current.pointerId);
    }
  };

  useEffect(() => {
    const current = drag.current;
    const sameMode =
      mode === 'normal'
        ? current?.kind === 'entity' || current?.kind === 'rectangle-move'
        : mode === 'rectangle' && current?.kind === 'rectangle';
    if (current && (!sameMode || current.width !== width || current.height !== height)) endDrag();
  }, [mode, width, height]);

  useEffect(() => endDrag, []);

  const dragPreview = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.moved ||=
      Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= 4;
    if (!current.moved) return;
    const tile = pointerTile(event.currentTarget, event.clientX, event.clientY, width, height);
    if (!tile) return;
    const rectangle =
      current.kind === 'entity'
        ? { ...tile, width: 1, height: 1 }
        : current.kind === 'rectangle-move' && current.rectangle
          ? {
              ...current.rectangle,
              x: current.rectangle.x + tile.x - current.origin.x,
              y: current.rectangle.y + tile.y - current.origin.y,
            }
          : {
              x: Math.min(current.origin.x, tile.x),
              y: Math.min(current.origin.y, tile.y),
              width: Math.abs(current.origin.x - tile.x) + 1,
              height: Math.abs(current.origin.y - tile.y) + 1,
            };
    const entity = entities.find(
      (entity) => entity.x === current.origin.x && entity.y === current.origin.y,
    );
    return {
      kind: current.kind,
      origin: current.origin,
      rectangle,
      rectangleIndex: current.rectangleIndex,
      valid:
        current.kind === 'entity'
          ? entity !== undefined &&
            availableEntity({ ...entity, ...tile }, entities, rectangles, current.origin)
          : rectangle.x >= 0 &&
            rectangle.y >= 0 &&
            rectangle.x + rectangle.width <= width &&
            rectangle.y + rectangle.height <= height &&
            !entities.some((entity) => containsTile(rectangle, connectionTile(entity))),
    };
  };

  return {
    preview,
    clickTile: (x: number, y: number) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return false;
      }
      onClickTile(x, y);
      return true;
    },
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0 || drag.current) return;
      suppressClick.current = false;
      const tile = pointerTile(event.currentTarget, event.clientX, event.clientY, width, height);
      if (!tile) return;
      const entity = entities.find((entity) => entity.x === tile.x && entity.y === tile.y);
      const rectangleIndex = rectangles.findLastIndex((rectangle) => containsTile(rectangle, tile));
      if (mode !== 'rectangle' && (mode !== 'normal' || (!entity && rectangleIndex === -1))) return;
      drag.current = {
        pointerId: event.pointerId,
        grid: event.currentTarget,
        origin: tile,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false,
        kind: mode === 'rectangle' ? 'rectangle' : entity ? 'entity' : 'rectangle-move',
        rectangleIndex: entity ? undefined : rectangleIndex,
        rectangle: entity ? undefined : rectangles[rectangleIndex],
        width,
        height,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (mode === 'normal') onClickTile(tile.x, tile.y);
    },
    onPointerMove: (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return;
      setPreview(dragPreview(event));
    },
    onPointerUp: (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const result = dragPreview(event);
      suppressClick.current = current.moved;
      endDrag();
      if (!result?.valid) return;
      if (result.kind === 'entity')
        onMoveEntity(result.origin, { x: result.rectangle.x, y: result.rectangle.y });
      else if (result.kind === 'rectangle-move' && result.rectangleIndex !== undefined)
        onMoveRectangle(result.rectangleIndex, result.rectangle);
      else onAddRectangle(result.rectangle);
    },
    onPointerCancel: (event: PointerEvent) => {
      if (event.pointerId !== drag.current?.pointerId) return;
      suppressClick.current = true;
      endDrag();
    },
    onLostPointerCapture: (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return;
      suppressClick.current = drag.current.moved;
      endDrag();
    },
  };
}
