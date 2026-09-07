import { ArrowRightIcon } from '@primer/octicons-react';
import type { JSX } from 'preact';
import { recipeName, staticData } from '../../data/index.ts';
import type { DesignAssembler, DesignBelt, DesignEntity, DesignPosition } from '../../design.ts';
import { iconStyle, recipeIconStyle } from '../icon.tsx';

export const TILE_SIZE = 12;

export type ViewportPoint = { x: number; y: number };

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

/** A transport belt positioned on one design tile. */
export function Belt({
  belt,
  status,
  hasLoop,
  worldOrigin,
  onPointerDown,
  onPointerMove,
}: {
  belt: DesignBelt;
  status: EntityPositionStatus;
  hasLoop: boolean;
  worldOrigin: ViewportPoint;
  onPointerDown: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
}) {
  const { x, y } = belt.position;
  const viewportPosition = worldToViewport(belt.position, worldOrigin);
  const isOverlapping = status === 'overlap';
  const isError = isOverlapping || hasLoop;
  const errorDescription = [
    ...(isOverlapping ? ['overlaps another entity'] : []),
    ...(hasLoop ? ['is part of a belt loop'] : []),
  ].join(', ');

  return (
    <div
      class={`cell-design-belt${isError ? ' cell-design-belt-error' : ''}`}
      role="img"
      aria-label={`Transport belt at ${x}, ${y}, pointing ${belt.direction}${errorDescription ? `, ${errorDescription}` : ''}`}
      title={`Transport belt (${x}, ${y}), ${belt.direction}${errorDescription ? ` — ${errorDescription}` : ''}`}
      data-position={`${x},${y}`}
      data-position-status={status}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      style={{
        left: `${viewportPosition.x}px`,
        top: `${viewportPosition.y}px`,
        width: `${TILE_SIZE}px`,
        height: `${TILE_SIZE}px`,
      }}
    >
      <ArrowRightIcon
        className="cell-design-belt-arrow"
        aria-hidden="true"
        data-direction={belt.direction}
      />
    </div>
  );
}

/** An assembler positioned on the design world's tile grid. */
export function Assembler({
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
