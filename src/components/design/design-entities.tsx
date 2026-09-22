import { ArrowRightIcon, ChevronRightIcon } from '@primer/octicons-react';
import type { JSX } from 'preact';
import { recipeName, resourceName } from '../../data/index.ts';
import { staticData } from '../../data/decode.ts';
import type {
  DesignAssembler,
  DesignBelt,
  DesignEntity,
  DesignInserter,
  DesignPipe,
  DesignPosition,
  DesignUndergroundPipe,
} from '../../compute/design.ts';
import { iconStyle, recipeIconStyle } from '../icon.tsx';
import type { AssemblerInputStatus, BeltItemTrace } from './design-belt-traces.ts';
import type { DesignSceneItems } from './design-scene.tsx';
import { fmt } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';

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
  items,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entityIndex: number;
  belt: DesignBelt;
  status: EntityPositionStatus;
  hasLoop: boolean;
  itemTraces: BeltItemTrace[];
  items?: DesignSceneItems;
  worldOrigin: ViewportPoint;
  onPointerEnter: JSX.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: JSX.PointerEventHandler<HTMLDivElement>;
}) {
  const { x, y } = belt.position;
  const viewportPosition = worldToViewport(belt.position, worldOrigin);
  const isOverlapping = status === 'overlap';
  const isError = isOverlapping || hasLoop;
  const itemDescription = itemTraces
    .map(({ item, side }) => {
      const details = items?.[item];
      return details
        ? `${side} side: ${details.name}, ${fmt(details.rate)}/s`
        : `${side} side: ${resourceName(item)} (${item})`;
    })
    .join('; ');
  const errorDescription = [
    ...(isOverlapping ? ['overlaps another entity'] : []),
    ...(hasLoop ? ['is part of a belt loop'] : []),
  ].join(', ');

  return (
    <div
      class={`cell-design-belt${isError ? ' cell-design-belt-error' : ''}`}
      role="img"
      aria-label={`Transport belt at ${x}, ${y}, pointing ${belt.direction}${itemDescription ? `, ${itemDescription}` : ''}${errorDescription ? `, ${errorDescription}` : ''}`}
      title={`Transport belt (${x}, ${y}), ${belt.direction}${itemDescription ? ` — ${itemDescription}` : ''}${errorDescription ? ` — ${errorDescription}` : ''}`}
      data-position={`${x},${y}`}
      data-entity-index={entityIndex}
      data-position-status={status}
      data-item-status={itemTraces.length === 0 ? 'empty' : 'traced-item'}
      data-direction={belt.direction}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: `${viewportPosition.x}px`,
        top: `${viewportPosition.y}px`,
        width: `${TILE_SIZE}px`,
        height: `${TILE_SIZE}px`,
      }}
    >
      {items &&
        (['left', 'right'] as const).map((side) => {
          const trace = itemTraces.find((candidate) => candidate.side === side);
          return (
            <span
              key={side}
              class="cell-design-belt-lane"
              data-side={side}
              style={{ backgroundColor: trace ? items[trace.item]?.colour : undefined }}
              aria-hidden="true"
            />
          );
        })}
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
  const isLong = inserter.reach === 2;
  const name = isLong ? 'Long inserter' : 'Inserter';

  return (
    <div
      class={`cell-design-inserter${isLong ? ' cell-design-inserter-long' : ''}${isOverlapping ? ' cell-design-inserter-error' : ''}`}
      role="img"
      aria-label={`${name} at ${x}, ${y}, pointing ${inserter.direction}${errorDescription}`}
      title={`${name} (${x}, ${y}), ${inserter.direction}${isOverlapping ? ' — overlaps another entity' : ''}`}
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

/** A one-tile section of fluid pipe. */
export function Pipe({
  entityIndex,
  pipe,
  status,
  fluids,
  resources,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entityIndex: number;
  pipe: DesignPipe;
  status: EntityPositionStatus;
  fluids: ResourceId[];
  resources?: DesignSceneItems;
  worldOrigin: ViewportPoint;
  onPointerEnter: JSX.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: JSX.PointerEventHandler<HTMLDivElement>;
}) {
  const { x, y } = pipe.position;
  const viewportPosition = worldToViewport(pipe.position, worldOrigin);
  const isOverlapping = status === 'overlap';
  const isMixed = fluids.length > 1;
  const isError = isOverlapping || isMixed;
  const fluidDescription = fluids
    .map((fluid) => {
      const details = resources?.[fluid];
      return details
        ? `${details.name}, ${fmt(details.rate)}/s`
        : `${resourceName(fluid)} (${fluid})`;
    })
    .join(', ');
  const errorDescription = [
    ...(isOverlapping ? ['overlaps another entity'] : []),
    ...(isMixed ? ['contains incompatible fluids'] : []),
  ].join(', ');
  const fluidColour = fluids.length === 1 ? resources?.[fluids[0]]?.colour : undefined;

  return (
    <div
      class={`cell-design-pipe${fluids.length === 1 ? ' cell-design-pipe-filled' : ''}${isError ? ' cell-design-pipe-error' : ''}`}
      role="img"
      aria-label={`Pipe at ${x}, ${y}${fluidDescription ? `, containing ${fluidDescription}` : ''}${errorDescription ? `, ${errorDescription}` : ''}`}
      title={`Pipe (${x}, ${y})${fluidDescription ? ` — ${fluidDescription}` : ''}${errorDescription ? ` — ${errorDescription}` : ''}`}
      data-position={`${x},${y}`}
      data-entity-index={entityIndex}
      data-position-status={status}
      data-fluid-status={isMixed ? 'mixed' : fluids.length === 1 ? 'filled' : 'empty'}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: `${viewportPosition.x}px`,
        top: `${viewportPosition.y}px`,
        width: `${TILE_SIZE}px`,
        height: `${TILE_SIZE}px`,
        '--cell-design-pipe-fluid': fluidColour,
      }}
    />
  );
}

/** A pipe-to-ground, drawn with its flat edge on the exposed connection side. */
export function UndergroundPipe({
  entityIndex,
  pipe,
  status,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entityIndex: number;
  pipe: DesignUndergroundPipe;
  status: EntityPositionStatus;
  worldOrigin: ViewportPoint;
  onPointerEnter: JSX.PointerEventHandler<SVGSVGElement>;
  onPointerLeave: JSX.PointerEventHandler<SVGSVGElement>;
}) {
  const { x, y } = pipe.position;
  const viewportPosition = worldToViewport(pipe.position, worldOrigin);
  const isOverlapping = status === 'overlap';
  const errorDescription = isOverlapping ? ', overlaps another entity' : '';
  const rotation =
    pipe.direction === 'west'
      ? undefined
      : pipe.direction === 'north'
        ? 'rotate(90 6 6)'
        : pipe.direction === 'east'
          ? 'rotate(180 6 6)'
          : 'rotate(270 6 6)';

  return (
    <svg
      class={`cell-design-underground-pipe${isOverlapping ? ' cell-design-underground-pipe-error' : ''}`}
      role="img"
      aria-label={`Pipe-to-ground at ${x}, ${y}, opening ${pipe.direction}${errorDescription}`}
      title={`Pipe-to-ground (${x}, ${y}), opening ${pipe.direction}${isOverlapping ? ' — overlaps another entity' : ''}`}
      data-position={`${x},${y}`}
      data-entity-index={entityIndex}
      data-position-status={status}
      data-direction={pipe.direction}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: `${viewportPosition.x}px`,
        top: `${viewportPosition.y}px`,
        width: `${TILE_SIZE}px`,
        height: `${TILE_SIZE}px`,
      }}
      viewBox="0 0 12 12"
    >
      <path d="M 0 1 H 5 A 5 5 0 0 1 5 11 H 0 Z" {...(rotation ? { transform: rotation } : {})} />
    </svg>
  );
}

/** An assembler positioned on the design world's tile grid. */
export function Assembler({
  entityIndex,
  assembler,
  status,
  inputStatus,
  ingredientCount,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entityIndex: number;
  assembler: DesignAssembler;
  status: EntityPositionStatus;
  inputStatus: AssemblerInputStatus | undefined;
  ingredientCount: number;
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
  const missing = inputStatus?.missing ?? [];
  const inputStatusClass =
    missing.length === 0
      ? ''
      : missing.length === ingredientCount
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
