import { useEffect, useRef, useState } from 'preact/hooks';
import type { FactoryModule } from '../../compute/modules.ts';
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
} from '../../compute/module-port-connections.ts';
import type { Position } from '../../bp/decode.ts';
import { staticData } from '../../data/decode.ts';
import { iconSprite } from '../icon.tsx';
import { portPoint, stepSpringLayout } from './spring-layout.ts';
import { preLayoutModules } from './pre-layout.ts';

const NO_CONNECTIONS: AttachedModuleConnection[] = [];
const NO_STATION_CONNECTIONS: AttachedStationConnection[] = [];
const NO_STOPS: Position[] = [];

function portLabel(port: { edge: string; x: number; y?: number; lane?: string }): string {
  return `${port.edge}:${port.x}${port.y === undefined ? '' : `:${port.y}`}:${port.lane ?? 'pipe'}`;
}

/** Animated module positions and the resource links attached to them. */
export function ModuleFootprints({
  modules,
  connections = NO_CONNECTIONS,
  stationConnections = NO_STATION_CONNECTIONS,
  inputStationStops = NO_STOPS,
  outputStationStops = NO_STOPS,
  zeroInputRegionRecipes,
}: {
  modules: FactoryModule[];
  connections?: AttachedModuleConnection[];
  stationConnections?: AttachedStationConnection[];
  inputStationStops?: Position[];
  outputStationStops?: Position[];
  zeroInputRegionRecipes?: ReadonlySet<string>;
}) {
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    pointerId: number;
    moduleId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const wake = useRef<() => void>(() => {});
  const [placed, setPlaced] = useState(() =>
    preLayoutModules(
      modules,
      {
        connections,
        stationConnections,
        inputStationStops,
        outputStationStops,
      },
      zeroInputRegionRecipes,
    ),
  );
  const physics = useRef(placed);
  useEffect(() => {
    const links = { connections, stationConnections, inputStationStops, outputStationStops };
    physics.current = preLayoutModules(modules, links, zeroInputRegionRecipes);
    setPlaced(physics.current);
    let frame = 0;
    let steps = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const tick = () => {
      frame = 0;
      const next = stepSpringLayout(physics.current, links, drag.current?.moduleId);
      physics.current = next;
      setPlaced(next);
      steps++;
      if (steps < 360 && next.some(({ vx, vy }) => Math.hypot(vx, vy) > 0.01)) schedule();
    };
    wake.current = () => {
      steps = 0;
      schedule();
    };
    if (modules.length) schedule();
    return () => {
      cancelAnimationFrame(frame);
      wake.current = () => {};
    };
  }, [
    modules,
    connections,
    stationConnections,
    inputStationStops,
    outputStationStops,
    zeroInputRegionRecipes,
  ]);

  const pointerPosition = (clientX: number, clientY: number) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    return {
      x: ((clientX - bounds.left) / bounds.width) * 192,
      y: ((clientY - bounds.top) / bounds.height) * 128,
    };
  };
  const finishDrag = (pointerId: number) => {
    if (drag.current?.pointerId !== pointerId) return;
    drag.current = null;
    wake.current();
  };
  const byId = new Map(placed.map((placement) => [placement.module.id, placement]));
  const pairCounts = new Map<string, number>();
  return (
    <svg
      ref={svgRef}
      class="cell-layout-modules"
      viewBox="0 0 192 128"
      aria-label={`${modules.length} factory modules`}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || event.pointerId !== active.pointerId) return;
        const pointer = pointerPosition(event.clientX, event.clientY);
        if (!pointer) return;
        physics.current = physics.current.map((placement) =>
          placement.module.id === active.moduleId
            ? {
                ...placement,
                x: Math.max(
                  0,
                  Math.min(192 - placement.module.size.width, pointer.x - active.offsetX),
                ),
                y: Math.max(
                  0,
                  Math.min(128 - placement.module.size.height, pointer.y - active.offsetY),
                ),
                vx: 0,
                vy: 0,
              }
            : placement,
        );
        setPlaced(physics.current);
        wake.current();
      }}
      onPointerUp={(event) => finishDrag(event.pointerId)}
      onPointerCancel={(event) => finishDrag(event.pointerId)}
    >
      {stationConnections.map((connection, index) => {
        const placement = byId.get(connection.moduleId);
        const stop = (connection.side === 'input' ? inputStationStops : outputStationStops)[
          connection.stationIndex
        ];
        if (!placement || !stop) return null;
        const stationX =
          connection.side === 'input' ? stop.x + 8 : stop.x + (placement.x < stop.x ? -8 : -4);
        const stationY = stop.y + (connection.side === 'input' ? 4.5 : 4);
        const modulePoint = portPoint(placement, connection.modulePort);
        const start =
          connection.side === 'input' ? [stationX, stationY] : [modulePoint.x, modulePoint.y];
        const end =
          connection.side === 'input' ? [modulePoint.x, modulePoint.y] : [stationX, stationY];
        return (
          <path
            key={`${connection.stationId}|${connection.moduleId}|${index}`}
            class={`cell-layout-module-connection is-station${connection.resource.startsWith('fluid:') ? ' is-fluid' : ''}${hoveredModuleId === connection.moduleId ? ' is-highlighted' : ''}`}
            d={`M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`}
            data-layout-station-connection={connection.side}
            data-layout-station-id={connection.stationId}
            data-layout-resource={connection.resource}
            data-layout-rate={connection.rate}
            data-layout-module-port={portLabel(connection.modulePort)}
          >
            <title>{`${connection.resource}: ${connection.rate}/s ${connection.side === 'input' ? 'from' : 'to'} ${connection.stationId}`}</title>
          </path>
        );
      })}
      {connections.map((connection, connectionIndex) => {
        const producer = byId.get(connection.producerId);
        const consumer = byId.get(connection.consumerId);
        if (!producer || !consumer) return null;
        const start = portPoint(producer, connection.producerPort);
        const end = portPoint(consumer, connection.consumerPort);
        const pair = `${connection.producerId}|${connection.consumerId}`;
        const index = pairCounts.get(pair) ?? 0;
        pairCounts.set(pair, index + 1);
        const bend = index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? 3 : -3);
        const middleX = (start.x + end.x) / 2;
        return (
          <path
            key={`${pair}|${connection.resource}|${connectionIndex}`}
            class={`cell-layout-module-connection${connection.resource.startsWith('fluid:') ? ' is-fluid' : ''}${hoveredModuleId === connection.producerId || hoveredModuleId === connection.consumerId ? ' is-highlighted' : ''}`}
            d={`M ${start.x} ${start.y} Q ${middleX} ${(start.y + end.y) / 2 + bend} ${end.x} ${end.y}`}
            data-layout-resource={connection.resource}
            data-layout-rate={connection.rate}
            data-layout-producer-port={portLabel(connection.producerPort)}
            data-layout-consumer-port={portLabel(connection.consumerPort)}
          >
            <title>{`${connection.resource}: ${connection.rate}/s from ${connection.producerId} to ${connection.consumerId}`}</title>
          </path>
        );
      })}
      {placed.map(({ module, x, y }) => {
        const product = staticData.recipes[module.recipe]?.products[0]?.resource;
        const [url, spriteX, spriteY, sheetSize] = iconSprite(
          `recipe:${module.recipe}`,
          ...(product ? [product] : []),
          'recipe:recipe-unknown',
        );
        const countLabel = `${module.machineCount}×`;
        return (
          <g
            key={module.id}
            data-layout-module={module.id}
            class={drag.current?.moduleId === module.id ? 'is-dragging' : undefined}
            onMouseEnter={() => setHoveredModuleId(module.id)}
            onMouseLeave={() => setHoveredModuleId(null)}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current) return;
              const pointer = pointerPosition(event.clientX, event.clientY);
              if (!pointer) return;
              const placement = physics.current.find((item) => item.module.id === module.id);
              if (!placement) return;
              drag.current = {
                pointerId: event.pointerId,
                moduleId: module.id,
                offsetX: pointer.x - placement.x,
                offsetY: pointer.y - placement.y,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
              event.preventDefault();
              setPlaced([...physics.current]);
            }}
          >
            <title>{`${module.recipe}: ${module.machineCount} machines, ${module.size.width}×${module.size.height} tiles`}</title>
            <rect
              class={`cell-layout-module${module.estimated ? ' is-estimated' : ''}`}
              x={x}
              y={y}
              width={module.size.width}
              height={module.size.height}
            />
            <text class="cell-layout-module-label" x={x + 0.4} y={y + 4}>
              {countLabel}
            </text>
            <svg
              class="cell-layout-module-icon"
              x={x + 0.7 + countLabel.length * 1.25}
              y={y + 1.1}
              width="3.3"
              height="3.3"
              viewBox={`${spriteX} ${spriteY} 32 32`}
              aria-hidden="true"
            >
              <image href={url} width={sheetSize} height={sheetSize} />
            </svg>
          </g>
        );
      })}
    </svg>
  );
}
