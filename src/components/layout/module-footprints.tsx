import { useEffect, useRef, useState } from 'preact/hooks';
import type { FactoryModule } from '../../compute/modules.ts';
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
  ModulePortReference,
} from '../../compute/module-port-connections.ts';
import type { Position } from '../../bp/decode.ts';
import { staticData } from '../../data/decode.ts';
import { iconSprite } from '../icon.tsx';
import { initialSpringPlacements, stepSpringLayout } from './spring-layout.ts';

const NO_CONNECTIONS: AttachedModuleConnection[] = [];
const NO_STATION_CONNECTIONS: AttachedStationConnection[] = [];
const NO_STOPS: Position[] = [];

function portPoint(
  placement: { module: FactoryModule; x: number; y: number },
  port: ModulePortReference,
): Position {
  const leftOffset = port.direction === 'south' ? 0.75 : 0.25;
  const laneOffset =
    port.lane === 'left' ? leftOffset : port.lane === 'right' ? 1 - leftOffset : 0.5;
  return {
    x: placement.x + port.x + laneOffset,
    y: placement.y + (port.edge === 'top' ? 0 : placement.module.size.height),
  };
}

/** Animated module positions and the resource links attached to them. */
export function ModuleFootprints({
  modules,
  connections = NO_CONNECTIONS,
  stationConnections = NO_STATION_CONNECTIONS,
  inputStationStops = NO_STOPS,
  outputStationStops = NO_STOPS,
}: {
  modules: FactoryModule[];
  connections?: AttachedModuleConnection[];
  stationConnections?: AttachedStationConnection[];
  inputStationStops?: Position[];
  outputStationStops?: Position[];
}) {
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);
  const physics = useRef(initialSpringPlacements(modules));
  const [placed, setPlaced] = useState(physics.current);
  useEffect(() => {
    physics.current = initialSpringPlacements(modules, physics.current);
    setPlaced(physics.current);
    let frame = 0;
    let steps = 0;
    const tick = () => {
      const next = stepSpringLayout(physics.current, {
        connections,
        stationConnections,
        inputStationStops,
        outputStationStops,
      });
      physics.current = next;
      setPlaced(next);
      steps++;
      if (steps < 360 && next.some(({ vx, vy }) => Math.hypot(vx, vy) > 0.01))
        frame = requestAnimationFrame(tick);
    };
    if (modules.length) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [modules, connections, stationConnections, inputStationStops, outputStationStops]);
  const byId = new Map(placed.map((placement) => [placement.module.id, placement]));
  const pairCounts = new Map<string, number>();
  return (
    <svg
      class="cell-layout-modules"
      viewBox="0 0 192 128"
      aria-label={`${modules.length} factory modules`}
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
            data-layout-module-port={`${connection.modulePort.edge}:${connection.modulePort.x}:${connection.modulePort.lane ?? 'pipe'}`}
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
            data-layout-producer-port={`${connection.producerPort.edge}:${connection.producerPort.x}:${connection.producerPort.lane ?? 'pipe'}`}
            data-layout-consumer-port={`${connection.consumerPort.edge}:${connection.consumerPort.x}:${connection.consumerPort.lane ?? 'pipe'}`}
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
            onMouseEnter={() => setHoveredModuleId(module.id)}
            onMouseLeave={() => setHoveredModuleId(null)}
          >
            <title>{`${module.recipe}: ${module.machineCount} machines, ${module.size.width}×${module.size.height} tiles`}</title>
            <rect
              class="cell-layout-module"
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
