import { useId, useState } from 'preact/hooks';
import type { RoutingDebugEntity, RoutingDebugRectangle } from '../boot/url-handler.tsx';
import { CARBON_LIGHT } from '../compute/colours.ts';
import type { PathCell } from '../compute/routing/path-search.ts';
import type { RoutingConflict } from '../compute/routing/types.ts';
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
  paths,
  conflict,
  selection,
  mode,
  onClickTile,
  onDeleteRectangle,
  onMoveEntity,
  onAddRectangle,
  onMoveRectangle,
  onFocusRectangle,
}: {
  width: number;
  height: number;
  entities: RoutingDebugEntity[];
  rectangles: RoutingDebugRectangle[];
  paths: {
    item: string;
    cells: PathCell[];
    source: RoutingDebugPosition;
    sink: RoutingDebugPosition;
  }[];
  conflict?: RoutingConflict;
  selection: { x: number; y: number } | undefined;
  mode: RoutingDebugMode;
  onClickTile: (x: number, y: number) => void;
  onDeleteRectangle: (index: number) => void;
  onMoveEntity: (origin: RoutingDebugPosition, destination: RoutingDebugPosition) => void;
  onAddRectangle: (rectangle: RoutingDebugRectangle) => void;
  onMoveRectangle: (index: number, rectangle: RoutingDebugRectangle) => void;
  onFocusRectangle: () => void;
}) {
  const gridId = useId();
  const [focusedRectangle, setFocusedRectangle] = useState<number>();
  const [hoveredRectangle, setHoveredRectangle] = useState<number>();
  const { preview, clickTile, ...interactions } = useRoutingDebugInteractions({
    width,
    height,
    mode,
    entities,
    rectangles,
    onClickTile,
    onMoveEntity,
    onAddRectangle: (rectangle) => {
      setFocusedRectangle(rectangles.length);
      onAddRectangle(rectangle);
    },
    onMoveRectangle: (index, rectangle) => {
      setFocusedRectangle(index);
      onMoveRectangle(index, rectangle);
    },
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
        if (tile && clickTile(tile.x, tile.y)) setFocusedRectangle(undefined);
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
      {rectangles.map((rectangle, index) => {
        const moving = preview?.kind === 'rectangle-move' && preview.rectangleIndex === index;
        const displayed = moving ? preview.rectangle : rectangle;
        return (
          <g
            key={index}
            class="routing-debug-reservation"
            onMouseEnter={() => setHoveredRectangle(index)}
            onMouseLeave={() => setHoveredRectangle(undefined)}
          >
            <rect
              class="routing-debug-reserved-space"
              role={mode === 'delete' ? 'button' : 'img'}
              tabIndex={mode === 'normal' || mode === 'delete' ? 0 : undefined}
              aria-label={`Reserved space at (${rectangle.x}, ${rectangle.y}), ${rectangle.width} by ${rectangle.height} tiles`}
              {...displayed}
              pointer-events={mode === 'normal' || mode === 'delete' ? 'auto' : 'none'}
              onFocus={() => {
                setFocusedRectangle(index);
                if (mode === 'normal') onFocusRectangle();
              }}
              onBlur={() => setFocusedRectangle(undefined)}
              onClick={(event) => {
                if (mode !== 'delete' && mode !== 'normal') return;
                event.stopPropagation();
                if (mode === 'delete') {
                  setFocusedRectangle(undefined);
                  setHoveredRectangle(undefined);
                  onDeleteRectangle(index);
                } else {
                  setFocusedRectangle(index);
                  onFocusRectangle();
                }
              }}
              onKeyDown={(event) => {
                if (mode !== 'delete' || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                setFocusedRectangle(undefined);
                setHoveredRectangle(undefined);
                onDeleteRectangle(index);
              }}
            />
            {(moving || focusedRectangle === index || hoveredRectangle === index) && (
              <RectangleDimensions rectangle={displayed} />
            )}
          </g>
        );
      })}
      {paths.map(({ item, cells, source, sink }) => {
        const points = [source, ...cells, sink]
          .map(({ x, y }) => `${x + 0.5},${y + 0.5}`)
          .join(' ');
        return (
          <g key={item} pointer-events="none">
            <polyline
              class="routing-debug-path"
              role="img"
              aria-label={`Computed path for ${item}`}
              points={points}
              stroke={CARBON_LIGHT.Yellow50}
              pointer-events="none"
            />
            <polyline
              class="routing-debug-path routing-debug-path-item"
              points={points}
              stroke={itemColour(item)}
              vector-effect="non-scaling-stroke"
              aria-hidden="true"
            />
          </g>
        );
      })}
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
            {entity.kind === 'sink' && (
              <rect
                class="routing-debug-entity-arrow"
                x="9"
                y="1.5"
                width="2"
                height="9"
                fill={itemColour(entity.item)}
                transform={`rotate(${directionAngle[entity.direction]} 0.5 0.5) scale(${1 / 12})`}
                pointer-events="none"
              />
            )}
          </g>
        );
      })}
      {preview && (
        <g aria-hidden="true" pointer-events="none">
          <rect
            class="routing-debug-drag-preview"
            data-valid={preview.valid}
            {...preview.rectangle}
            aria-hidden="true"
            pointer-events="none"
          />
          {preview.kind === 'rectangle' && <RectangleDimensions rectangle={preview.rectangle} />}
        </g>
      )}
      {conflict && (
        <path
          class="routing-debug-conflict"
          role="img"
          aria-label={`Routing conflict between ${conflict.first} and ${conflict.second} at (${conflict.cell.x}, ${conflict.cell.y})`}
          d="M 0.15 0.15 L 0.85 0.85 M 0.85 0.15 L 0.15 0.85"
          transform={`translate(${conflict.cell.x} ${conflict.cell.y})`}
          pointer-events="none"
        />
      )}
    </svg>
  );
}

function RectangleDimensions({ rectangle }: { rectangle: RoutingDebugRectangle }) {
  const label = `${rectangle.width}x${rectangle.height}`;
  return (
    <text
      class="routing-debug-rectangle-dimensions"
      x={rectangle.x + rectangle.width / 2}
      y={rectangle.y + rectangle.height / 2}
      font-size={Math.min(1.2, rectangle.height * 0.4, rectangle.width / label.length)}
      text-anchor="middle"
      dominant-baseline="central"
      pointer-events="none"
    >
      {label}
    </text>
  );
}
