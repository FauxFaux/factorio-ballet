import { ArrowRightIcon, ChevronRightIcon } from '@primer/octicons-react';
import type { JSX } from 'preact';
import { recipeName, resourceName, staticData } from '../../data/index.ts';
import type {
  DesignAssembler,
  DesignBelt,
  DesignEntity,
  DesignInserter,
  DesignPosition,
} from '../../design.ts';
import { iconStyle, recipeIconStyle } from '../icon.tsx';
import type { AssemblerInputStatus, BeltItemTrace } from './design-belts.ts';

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
  entityIndex,
  belt,
  status,
  hasLoop,
  itemTraces,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entityIndex: number;
  belt: DesignBelt;
  status: EntityPositionStatus;
  hasLoop: boolean;
  itemTraces: BeltItemTrace[];
  worldOrigin: ViewportPoint;
  onPointerEnter: JSX.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: JSX.PointerEventHandler<HTMLDivElement>;
}) {
  const { x, y } = belt.position;
  const viewportPosition = worldToViewport(belt.position, worldOrigin);
  const isOverlapping = status === 'overlap';
  const isError = isOverlapping || hasLoop;
  const itemDescription = itemTraces
    .map(({ item, side }) => `${side} side: ${resourceName(item)} (${item})`)
    .join('; ');
  const errorDescription = [
    ...(isOverlapping ? ['overlaps another entity'] : []),
    ...(hasLoop ? ['is part of a belt loop'] : []),
  ].join(', ');

  return (
    <div
      class={`cell-design-belt cell-design-belt-${itemTraces.length === 0 ? 'empty' : 'item'}${isError ? ' cell-design-belt-error' : ''}`}
      role="img"
      aria-label={`Transport belt at ${x}, ${y}, pointing ${belt.direction}${itemDescription ? `, ${itemDescription}` : ''}${errorDescription ? `, ${errorDescription}` : ''}`}
      title={`Transport belt (${x}, ${y}), ${belt.direction}${itemDescription ? ` — ${itemDescription}` : ''}${errorDescription ? ` — ${errorDescription}` : ''}`}
      data-position={`${x},${y}`}
      data-entity-index={entityIndex}
      data-position-status={status}
      data-item-status={itemTraces.length === 0 ? 'empty' : 'traced-item'}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: `${viewportPosition.x}px`,
        top: `${viewportPosition.y}px`,
        width: `${TILE_SIZE}px`,
        height: `${TILE_SIZE}px`,
      }}
    >
      <ChevronRightIcon
        className="cell-design-belt-arrow"
        aria-hidden="true"
        data-direction={belt.direction}
      />
    </div>
  );
}

/** An inserter positioned on one design tile. */
export function Inserter({
  entityIndex,
  inserter,
  status,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entityIndex: number;
  inserter: DesignInserter;
  status: EntityPositionStatus;
  worldOrigin: ViewportPoint;
  onPointerEnter: JSX.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: JSX.PointerEventHandler<HTMLDivElement>;
}) {
  const { x, y } = inserter.position;
  const viewportPosition = worldToViewport(inserter.position, worldOrigin);
  const isOverlapping = status === 'overlap';
  const errorDescription = isOverlapping ? ', overlaps another entity' : '';

  return (
    <div
      class={`cell-design-inserter${isOverlapping ? ' cell-design-inserter-error' : ''}`}
      role="img"
      aria-label={`Inserter at ${x}, ${y}, pointing ${inserter.direction}${errorDescription}`}
      title={`Inserter (${x}, ${y}), ${inserter.direction}${isOverlapping ? ' — overlaps another entity' : ''}`}
      data-position={`${x},${y}`}
      data-entity-index={entityIndex}
      data-position-status={status}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: `${viewportPosition.x}px`,
        top: `${viewportPosition.y}px`,
        width: `${TILE_SIZE}px`,
        height: `${TILE_SIZE}px`,
      }}
    >
      <ArrowRightIcon
        className="cell-design-inserter-arrow"
        aria-hidden="true"
        data-direction={inserter.direction}
      />
    </div>
  );
}

/** An assembler positioned on the design world's tile grid. */
export function Assembler({
  entityIndex,
  assembler,
  status,
  inputStatus,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entityIndex: number;
  assembler: DesignAssembler;
  status: EntityPositionStatus;
  inputStatus: AssemblerInputStatus | undefined;
  worldOrigin: ViewportPoint;
  onPointerEnter: JSX.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: JSX.PointerEventHandler<HTMLDivElement>;
}) {
  const recipe = staticData.recipes[assembler.recipe];
  const name = recipeName(assembler.recipe);
  const { x, y } = assembler.position;
  const { width, height } = assembler.size;
  const viewportPosition = worldToViewport(assembler.position, worldOrigin);
  const isOverlapping = status === 'overlap';
  const itemIngredientCount = new Set(
    (recipe?.ingredients ?? [])
      .map(({ resource }) => resource)
      .filter((resource) => resource.startsWith('item:')),
  ).size;
  const missing = inputStatus?.missing ?? [];
  const inputStatusClass =
    missing.length === 0
      ? ''
      : missing.length === itemIngredientCount
        ? ' cell-design-assembler-all-inputs-missing'
        : ' cell-design-assembler-some-inputs-missing';
  const missingDescription = missing
    .map((resource) => `${resourceName(resource)} (${resource})`)
    .join(', ');

  return (
    <div
      class={`cell-design-assembler${inputStatusClass}${isOverlapping ? ' cell-design-assembler-error' : ''}`}
      role="img"
      aria-label={`${name} assembler at ${x}, ${y}${isOverlapping ? ', overlaps another entity' : ''}`}
      title={`${name} (${x}, ${y})${missingDescription ? ` — missing resources: ${missingDescription}` : ''}${isOverlapping ? ' — overlaps another entity' : ''}`}
      data-position={`${x},${y}`}
      data-entity-index={entityIndex}
      data-position-status={status}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
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
