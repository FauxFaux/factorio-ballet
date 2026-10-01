import { useId } from 'preact/hooks';
import type { RoutingDebugEntity } from '../boot/url-handler.tsx';
import { CARBON_LIGHT } from '../compute/colours.ts';

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
  selection,
  mode,
  onClickTile,
}: {
  width: number;
  height: number;
  entities: RoutingDebugEntity[];
  selection: { x: number; y: number } | undefined;
  mode: 'normal' | 'source' | 'sink' | 'delete';
  onClickTile: (x: number, y: number) => void;
}) {
  const gridId = useId();
  return (
    <svg
      class="routing-debug-grid"
      role="group"
      aria-label={`Routing grid, ${width} by ${height} tiles`}
      data-mode={mode}
      viewBox={`0 0 ${width} ${height}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        // SVG's default preserveAspectRatio centers the grid if the box has a different ratio.
        const scale = Math.min(bounds.width / width, bounds.height / height);
        if (scale <= 0) return;
        const left = bounds.left + (bounds.width - width * scale) / 2;
        const top = bounds.top + (bounds.height - height * scale) / 2;
        const x = Math.floor((event.clientX - left) / scale);
        const y = Math.floor((event.clientY - top) / scale);
        if (x >= 0 && x < width && y >= 0 && y < height) onClickTile(x, y);
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
      {entities.map((entity) => {
        const label = `${entity.kind === 'source' ? 'Source' : 'Sink'} at (${entity.x}, ${entity.y}), ${entity.item}, ${entity.rate} items/s, ${entity.direction}`;
        return (
          <g
            key={`${entity.x},${entity.y}`}
            class="routing-debug-entity"
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selection?.x === entity.x && selection.y === entity.y}
            data-kind={entity.kind}
            transform={`translate(${entity.x} ${entity.y})`}
            onClick={(event) => {
              event.stopPropagation();
              onClickTile(entity.x, entity.y);
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
    </svg>
  );
}
