import { useId, useMemo } from 'preact/hooks';
import { useDataset } from '../../dataset/context.tsx';
import { resourceName } from '../../data/index.ts';
import type { ResourceId } from '../../types.ts';
import { iconSprite } from '../icon.tsx';
import type {
  BobLayout,
  BobProblem,
  BobConflict,
  BobInserter,
  Point,
} from '../../compute/bobs/types.ts';

const inserterColors = ['#fcd34d', '#67e8f9', '#f9a8d4', '#bef264', '#c4b5fd', '#fdba74'];

export function BobLayoutDrawing({
  layout,
  problem,
  conflicts = [],
}: {
  layout: BobLayout;
  problem: BobProblem;
  conflicts?: BobConflict[];
}) {
  const ds = useDataset();
  const markerId = useId();
  const gridId = useId();
  const inserterEndpoints = useMemo(() => spreadEndpoints(layout.inserters), [layout.inserters]);
  return (
    <svg
      class="bobs-layout-canvas"
      role="img"
      aria-label="Bob assembler layout"
      viewBox={`-0.3 -0.3 ${layout.width + 0.6} ${layout.height + 0.6}`}
    >
      <defs>
        <pattern id={gridId} width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 H 0 V 1" class="bobs-layout-grid" />
        </pattern>
        {inserterColors.map((color, i) => (
          <marker
            key={color}
            id={`${markerId}-${i}`}
            viewBox="-2 -2 14 14"
            refX="8"
            refY="5"
            markerWidth="4.2"
            markerHeight="4.2"
            orient="auto-start-reverse"
          >
            <path class="bobs-layout-arrowhead" d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        ))}
      </defs>
      <rect width={layout.width} height={layout.height} fill={`url(#${gridId})`} />
      {layout.nodes.map((node) => {
        const machineIndex = problem.machines.findIndex((machine) => machine.id === node.id);
        const recipeId = problem.machines[machineIndex]?.recipe;
        const product = recipeId && ds.data.recipes[recipeId]?.products[0]?.resource;
        const iconKeys =
          node.kind === 'assembler'
            ? [`recipe:${recipeId}`, ...(product ? [product] : []), 'recipe:recipe-unknown']
            : node.resource
              ? [node.resource]
              : [];
        const sprite =
          node.kind !== 'chest' && iconKeys.length
            ? iconSprite(ds.iconMap, ...iconKeys)
            : undefined;
        const iconSize =
          node.kind === 'assembler'
            ? Math.min(1.2, node.size.width * 0.6, node.size.height * 0.6)
            : 0.75;
        const centerX = node.position.x + node.size.width / 2;
        const centerY = node.position.y + node.size.height / 2;
        return (
          <g key={node.id}>
            <title>
              {node.resource
                ? `${node.kind === 'source' ? 'Source' : 'Sink'}: ${resourceName(ds.data, node.resource)}`
                : node.label}
            </title>
            <rect
              class={`bobs-layout-node is-${node.kind}`}
              x={node.position.x + 0.06}
              y={node.position.y + 0.06}
              width={node.size.width - 0.12}
              height={node.size.height - 0.12}
            />
            {sprite && (
              <svg
                x={centerX - iconSize / 2}
                y={centerY - iconSize / 2 - (node.kind === 'assembler' ? 0.2 : 0)}
                width={iconSize}
                height={iconSize}
                viewBox={`${sprite[1]} ${sprite[2]} 32 32`}
                overflow="hidden"
                aria-hidden="true"
              >
                <image href={sprite[0]} width={sprite[3]} height={sprite[4]} />
              </svg>
            )}
            {node.kind === 'assembler' && (
              <text class="bobs-layout-label" x={centerX} y={centerY + iconSize / 2 + 0.08}>
                {machineIndex + 1}
              </text>
            )}
          </g>
        );
      })}
      {conflicts.map((conflict, i) => (
        <g key={i} role="img" aria-label={`Inserter conflict region: ${conflict.message}`}>
          <title>{conflict.message}</title>
          {conflict.tiles.map((tile) => (
            <rect
              key={`${tile.x},${tile.y}`}
              class="bobs-layout-conflict"
              x={tile.x + 0.03}
              y={tile.y + 0.03}
              width="0.94"
              height="0.94"
            />
          ))}
        </g>
      ))}
      {layout.inserters.map((inserter, i) => {
        const pivot = { x: inserter.position.x + 0.5, y: inserter.position.y + 0.5 };
        const { pickup, dropoff } = inserterEndpoints[i];
        const pickupLength = Math.hypot(pickup.x - pivot.x, pickup.y - pivot.y);
        const dropoffLength = Math.hypot(dropoff.x - pivot.x, dropoff.y - pivot.y);
        // Round a substantial part of each arm, leaving straight ends for the arrowhead.
        const bend = Math.min(0.9, pickupLength / 2, dropoffLength / 2);
        const entryRatio = pickupLength > 0 ? bend / pickupLength : 0;
        const exitRatio = dropoffLength > 0 ? bend / dropoffLength : 0;
        const entry = {
          x: pivot.x + (pickup.x - pivot.x) * entryRatio,
          y: pivot.y + (pickup.y - pivot.y) * entryRatio,
        };
        const exit = {
          x: pivot.x + (dropoff.x - pivot.x) * exitRatio,
          y: pivot.y + (dropoff.y - pivot.y) * exitRatio,
        };
        const path = `M ${pickup.x} ${pickup.y} L ${entry.x} ${entry.y} Q ${pivot.x} ${pivot.y} ${exit.x} ${exit.y} L ${dropoff.x} ${dropoff.y}`;
        return (
          <g key={i} style={{ color: inserterColors[i % inserterColors.length] }}>
            <title>
              {Object.entries(inserter.rates)
                .map(([r, rate]) => `${resourceName(ds.data, r as ResourceId)}: ${rate}/s`)
                .join(', ')}
              ; capacity {inserter.capacity.toFixed(1)}/s
            </title>
            <path class="bobs-layout-arm-border" d={path} />
            <path
              class="bobs-layout-arm"
              d={path}
              marker-end={`url(#${markerId}-${i % inserterColors.length})`}
            />
            <rect
              class="bobs-layout-inserter"
              x={inserter.position.x + 0.44}
              y={inserter.position.y + 0.44}
              width="0.12"
              height="0.12"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Assign display-only endpoints to sub-tile centers, sharing across pickups and dropoffs. */
function spreadEndpoints(inserters: BobInserter[]): { pickup: Point; dropoff: Point }[] {
  const tiles = new Map<string, Point[]>();
  const endpoints = inserters.map((inserter) => {
    const points = { pickup: { ...inserter.pickup }, dropoff: { ...inserter.dropoff } };
    for (const point of [points.pickup, points.dropoff]) {
      const key = `${point.x},${point.y}`;
      const shared = tiles.get(key);
      if (shared) shared.push(point);
      else tiles.set(key, [point]);
    }
    return points;
  });
  for (const shared of tiles.values()) {
    const divisions = Math.ceil(Math.sqrt(shared.length));
    shared.forEach((point, index) => {
      point.x += ((index % divisions) + 0.5) / divisions;
      point.y += (Math.floor(index / divisions) + 0.5) / divisions;
    });
  }
  return endpoints;
}
