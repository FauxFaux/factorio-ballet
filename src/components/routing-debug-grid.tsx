import { useId } from 'preact/hooks';
import type { RoutingDebugEntity, RoutingDebugRectangle } from '../boot/url-handler.tsx';
import { CARBON_LIGHT } from '../compute/colours.ts';
import {
  pointerTile,
  useRoutingDebugInteractions,
  type RoutingDebugMode,
  type RoutingDebugPosition,
} from './routing-debug-interactions.ts';

const palette = [
  CARBON_LIGHT.Cyan50,
  CARBON_LIGHT.Magenta50,
  CARBON_LIGHT.Purple50,
  CARBON_LIGHT.Yellow50,
  CARBON_LIGHT.Red50,
  CARBON_LIGHT.Teal50,
];

const directionAngle: Record<RoutingDebugEntity['direction'], number> = {
  east: 0,
  south: 90,
  west: 180,
  north: 270,
};

function itemColour(item: string): string {
  let hash = 0;
  for (const character of item) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length]!;
}

/** One SVG unit is one tile, with (0, 0) at the top-left corner. */
export function RoutingDebugGrid({
  width,
  height,
  entities,
  rectangles,
  selection,
  mode,
  onClickTile,
  onDeleteRectangle,
  onMoveEntity,
  onAddRectangle,
}: {
  width: number;
  height: number;
  entities: RoutingDebugEntity[];
  rectangles: RoutingDebugRectangle[];
  selection: { x: number; y: number } | undefined;
  mode: RoutingDebugMode;
  onClickTile: (x: number, y: number) => void;
  onDeleteRectangle: (index: number) => void;
  onMoveEntity: (origin: RoutingDebugPosition, destination: RoutingDebugPosition) => void;
  onAddRectangle: (rectangle: RoutingDebugRectangle) => void;
}) {
  const gridId = useId();
  const { preview, clickTile, ...interactions } = useRoutingDebugInteractions({
    width,
    height,
    mode,
    entities,
    rectangles,
    onClickTile,
    onMoveEntity,
    onAddRectangle,
  });
  return (
    <svg
      class="routing-debug-grid"
      role="group"
      aria-label={`Routing grid, ${width} by ${height} tiles`}
      data-mode={mode}
      viewBox={`0 0 ${width} ${height}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      {...interactions}
      onClick={(event) => {
        const tile = pointerTile(event.currentTarget, event.clientX, event.clientY, width, height);
        if (tile) clickTile(tile.x, tile.y);
      }}
    >
      <defs>
        <pattern id={`${gridId}-tile`} width="1" height="1" patternUnits="userSpaceOnUse">
          <path
            class="routing-debug-grid-minor"
            d="M 1 0 H 0 V 1"
            vector-effect="non-scaling-stroke"
          />
        </pattern>
        <pattern id={`${gridId}-major`} width="8" height="8" patternUnits="userSpaceOnUse">
          <path
            class="routing-debug-grid-major"
            d="M 8 0 H 0 V 8"
            vector-effect="non-scaling-stroke"
          />
        </pattern>
      </defs>
      <g aria-hidden="true" pointer-events="none">
        <rect width={width} height={height} fill={`url(#${gridId}-tile)`} />
        <rect width={width} height={height} fill={`url(#${gridId}-major)`} />
      </g>
      {rectangles.map((rectangle, index) => (
        <rect
          key={index}
          class="routing-debug-reserved-space"
          role={mode === 'delete' ? 'button' : 'img'}
          tabIndex={mode === 'delete' ? 0 : undefined}
          aria-label={`Reserved space at (${rectangle.x}, ${rectangle.y}), ${rectangle.width} by ${rectangle.height} tiles`}
          {...rectangle}
          pointer-events={mode === 'delete' ? 'auto' : 'none'}
          onClick={(event) => {
            if (mode !== 'delete') return;
            event.stopPropagation();
            onDeleteRectangle(index);
          }}
          onKeyDown={(event) => {
            if (mode !== 'delete' || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            onDeleteRectangle(index);
          }}
        />
      ))}
      {entities.map((entity) => {
        const label = `${entity.kind === 'source' ? 'Source' : 'Sink'} at (${entity.x}, ${entity.y}), ${entity.item}, ${entity.rate} items/s, ${entity.direction}`;
        const position =
          preview?.kind === 'entity' &&
          preview.origin.x === entity.x &&
          preview.origin.y === entity.y
            ? preview.rectangle
            : entity;
        return (
          <g
            key={`${entity.x},${entity.y}`}
            class="routing-debug-entity"
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selection?.x === entity.x && selection.y === entity.y}
            data-kind={entity.kind}
            transform={`translate(${position.x} ${position.y})`}
            onClick={(event) => {
              event.stopPropagation();
              clickTile(entity.x, entity.y);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onClickTile(entity.x, entity.y);
            }}
          >
            <title>{label}</title>
            <rect
              class="routing-debug-entity-square"
              x="0.025"
              y="0.025"
              width="0.95"
              height="0.95"
            />
            {/* The same arrow shape as the assembler's fluid ports, scaled to one tile. */}
            <path
              class="routing-debug-entity-arrow"
              d="M 10.5 6 L 2.5 1.5 L 2.5 10.5 Z"
              fill={itemColour(entity.item)}
              transform={`rotate(${directionAngle[entity.direction]} 0.5 0.5) scale(${1 / 12})`}
              pointer-events="none"
            />
          </g>
        );
      })}
      {preview && (
        <rect
          class="routing-debug-drag-preview"
          data-valid={preview.valid}
          {...preview.rectangle}
          aria-hidden="true"
          pointer-events="none"
        />
      )}
    </svg>
  );
}
