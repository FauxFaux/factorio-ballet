import { useEffect, useRef, useState } from 'preact/hooks';
import type { FactoryModule } from '../../compute/modules.ts';
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
} from '../../compute/module-port-connections.ts';
import type { CellLayout, FrozenModulePositions } from '../../compute/layout.ts';
import type { Position } from '../../bp/decode.ts';
import { useDataset } from '../../dataset/context.tsx';
import { iconSprite } from '../icon.tsx';
import { placementSize, portPoint, stepSpringLayout } from './spring-layout.ts';
import { preLayoutModules } from './pre-layout.ts';
import { ConnectionArrows } from './connection-arrow.tsx';

const NO_CONNECTIONS: AttachedModuleConnection[] = [];
const NO_STATION_CONNECTIONS: AttachedStationConnection[] = [];
const NO_FROZEN_MODULES: FrozenModulePositions = {};
const NO_ROTATIONS: NonNullable<CellLayout['moduleRotations']> = {};
const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
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
  frozenModules = NO_FROZEN_MODULES,
  onFrozenModulesChange,
  moduleRotations = NO_ROTATIONS,
  onModuleRotationsChange,
}: {
  moduleRotations?: CellLayout['moduleRotations'];
  onModuleRotationsChange?: (rotations: NonNullable<CellLayout['moduleRotations']>) => void;
  modules: FactoryModule[];
  frozenModules?: FrozenModulePositions;
  onFrozenModulesChange?: (positions: FrozenModulePositions) => void;
  connections?: AttachedModuleConnection[];
  stationConnections?: AttachedStationConnection[];
  inputStationStops?: Position[];
  outputStationStops?: Position[];
  zeroInputRegionRecipes?: ReadonlySet<string>;
}) {
  const { data, iconMap } = useDataset();
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);
  const cursor = useRef<{ clientX: number; clientY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    pointerId: number;
    moduleId: string;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const rotations = useRef(moduleRotations);
  const savedPositions = useRef(frozenModules);
  savedPositions.current = frozenModules;
  const pinned = useRef(new Set<string>());
  const suppressClick = useRef<string | null>(null);
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
    pinned.current.clear();
    drag.current = null;
    physics.current = preLayoutModules(modules, links, zeroInputRegionRecipes).map((placement) => {
      const position = savedPositions.current[placement.module.id];
      placement = { ...placement, rotation: rotations.current[placement.module.id] ?? 'north' };
      if (!position) return placement;
      pinned.current.add(placement.module.id);
      return { ...placement, ...position, vx: 0, vy: 0 };
    });
    setPlaced(physics.current);
    let frame = 0;
    let steps = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const tick = () => {
      frame = 0;
      const fixed = new Set(pinned.current);
      if (drag.current) fixed.add(drag.current.moduleId);
      const next = stepSpringLayout(physics.current, links, fixed);
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

  useEffect(() => {
    pinned.current.clear();
    physics.current = physics.current.map((placement) => {
      const position = frozenModules[placement.module.id];
      if (!position) return placement;
      pinned.current.add(placement.module.id);
      return { ...placement, ...position, vx: 0, vy: 0 };
    });
    setPlaced(physics.current);
    wake.current();
  }, [frozenModules]);

  useEffect(() => {
    rotations.current = moduleRotations;
    physics.current = physics.current.map((placement) => ({
      ...placement,
      rotation: moduleRotations[placement.module.id] ?? 'north',
    }));
    setPlaced(physics.current);
    wake.current();
  }, [moduleRotations]);

  useEffect(() => {
    const rotate = (event: KeyboardEvent) => {
      if (
        !hoveredModuleId ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !['p', 'r'].includes(event.key.toLowerCase())
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select'))
      )
        return;
      const placement = physics.current.find(({ module }) => module.id === hoveredModuleId);
      if (!placement) return;
      event.preventDefault();
      const rotation = DIRECTIONS[(DIRECTIONS.indexOf(placement.rotation ?? 'north') + 1) % 4]!;
      const next = { ...rotations.current, [hoveredModuleId]: rotation };
      rotations.current = next;
      const pointer = cursor.current
        ? pointerPosition(cursor.current.clientX, cursor.current.clientY)
        : null;
      const size = placementSize(placement);
      const pivot = pointer ?? {
        x: placement.x + size.width / 2,
        y: placement.y + size.height / 2,
      };
      // Rotate the cursor's local point clockwise, then translate it back to the cursor.
      const offsetX = size.height - (pivot.y - placement.y);
      const offsetY = pivot.x - placement.x;
      const rotated = {
        ...placement,
        rotation,
        x: pivot.x - offsetX,
        y: pivot.y - offsetY,
        vx: 0,
        vy: 0,
      };
      physics.current = physics.current.map((item) => (item === placement ? rotated : item));
      if (drag.current?.moduleId === hoveredModuleId) {
        drag.current.offsetX = offsetX;
        drag.current.offsetY = offsetY;
      }
      if (pinned.current.has(hoveredModuleId)) persistFrozenModules();
      setPlaced(physics.current);
      onModuleRotationsChange?.(next);
      wake.current();
    };
    window.addEventListener('keydown', rotate);
    return () => window.removeEventListener('keydown', rotate);
  }, [hoveredModuleId, onModuleRotationsChange, onFrozenModulesChange]);

  const persistFrozenModules = () => {
    onFrozenModulesChange?.(
      Object.fromEntries(
        physics.current
          .filter(({ module }) => pinned.current.has(module.id))
          .map(({ module, x, y }) => [module.id, { x, y }]),
      ),
    );
  };

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
    if (drag.current.moved) {
      pinned.current.add(drag.current.moduleId);
      suppressClick.current = drag.current.moduleId;
      persistFrozenModules();
    }
    drag.current = null;
    setPlaced([...physics.current]);
    wake.current();
  };
  const byId = new Map(placed.map((placement) => [placement.module.id, placement]));
  const pairCounts = new Map<string, number>();
  const arrows = new Map<
    string,
    {
      owner: string;
      point: Position;
      angle: number;
      side: 'input' | 'output';
      resource: AttachedModuleConnection['resource'];
    }
  >();
  const addModuleArrow = (
    id: string,
    port: AttachedModuleConnection['producerPort'],
    side: 'input' | 'output',
    resource: AttachedModuleConnection['resource'],
  ) => {
    const placement = byId.get(id);
    if (!placement) return;
    const outward = { right: 0, bottom: 90, left: 180, top: 270 }[port.edge];
    const rotation = DIRECTIONS.indexOf(placement.rotation ?? 'north') * 90;
    arrows.set(`${id}|${portLabel(port)}|${side}|${resource}`, {
      owner: `module:${id}`,
      point: portPoint(placement, port),
      angle: outward + rotation + (side === 'input' ? 180 : 0),
      side,
      resource,
    });
  };
  for (const connection of connections) {
    addModuleArrow(connection.producerId, connection.producerPort, 'output', connection.resource);
    addModuleArrow(connection.consumerId, connection.consumerPort, 'input', connection.resource);
  }
  for (const connection of stationConnections) {
    const placement = byId.get(connection.moduleId);
    const stop = (connection.side === 'input' ? inputStationStops : outputStationStops)[
      connection.stationIndex
    ];
    if (!placement || !stop) continue;
    addModuleArrow(
      connection.moduleId,
      connection.modulePort,
      connection.side,
      connection.resource,
    );
    const side = connection.side === 'input' ? 'output' : 'input';
    const x = connection.side === 'input' ? stop.x + 8 : stop.x + (placement.x < stop.x ? -8 : -4);
    arrows.set(`${connection.stationId}|${x}|${connection.resource}`, {
      owner: `station:${connection.stationId}`,
      point: { x, y: stop.y + (connection.side === 'input' ? 4.5 : 4) },
      angle: connection.side === 'input' || placement.x >= stop.x ? 0 : 180,
      side,
      resource: connection.resource,
    });
  }
  return (
    <svg
      ref={svgRef}
      class="cell-layout-modules"
      viewBox="0 0 192 128"
      aria-label={`${modules.length} factory modules`}
      onMouseMove={(event) => {
        cursor.current = { clientX: event.clientX, clientY: event.clientY };
      }}
      onPointerMove={(event) => {
        cursor.current = { clientX: event.clientX, clientY: event.clientY };
        const active = drag.current;
        if (!active || event.pointerId !== active.pointerId) return;
        if (!active.moved) {
          if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 3) return;
          active.moved = true;
        }
        const pointer = pointerPosition(event.clientX, event.clientY);
        if (!pointer) return;
        physics.current = physics.current.map((placement) =>
          placement.module.id === active.moduleId
            ? {
                ...placement,
                x: Math.max(
                  0,
                  Math.min(192 - placementSize(placement).width, pointer.x - active.offsetX),
                ),
                y: Math.max(
                  0,
                  Math.min(128 - placementSize(placement).height, pointer.y - active.offsetY),
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
      {placed.map((placement) => {
        const { module, x, y, rotation } = placement;
        const size = placementSize(placement);
        const product = data.recipes[module.recipe]?.products[0]?.resource;
        const [url, spriteX, spriteY, sheetWidth, sheetHeight] = iconSprite(
          iconMap,
          `recipe:${module.recipe}`,
          ...(product ? [product] : []),
          'recipe:recipe-unknown',
        );
        const countLabel = `${module.machineCount}×`;
        const textWidth = countLabel.length * 1.25;
        const labelWidth = textWidth + 0.4 + 3.3;
        const stackedLabel = size.width < labelWidth + 1.2;
        return (
          <g
            key={module.id}
            data-layout-module={module.id}
            data-layout-rotation={rotation ?? 'north'}
            class={
              drag.current?.moduleId === module.id
                ? 'is-dragging'
                : pinned.current.has(module.id)
                  ? 'is-pinned'
                  : undefined
            }
            onClick={() => {
              if (suppressClick.current === module.id) {
                suppressClick.current = null;
                return;
              }
              if (pinned.current.delete(module.id)) {
                persistFrozenModules();
                setPlaced([...physics.current]);
                wake.current();
              }
            }}
            onMouseEnter={(event) => {
              cursor.current = { clientX: event.clientX, clientY: event.clientY };
              setHoveredModuleId(module.id);
            }}
            onMouseLeave={() => setHoveredModuleId(null)}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current) return;
              const pointer = pointerPosition(event.clientX, event.clientY);
              if (!pointer) return;
              const placement = physics.current.find((item) => item.module.id === module.id);
              if (!placement) return;
              suppressClick.current = null;
              drag.current = {
                pointerId: event.pointerId,
                moduleId: module.id,
                offsetX: pointer.x - placement.x,
                offsetY: pointer.y - placement.y,
                startX: event.clientX,
                startY: event.clientY,
                moved: false,
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
              width={size.width}
              height={size.height}
            />
            <g transform={`translate(${x + size.width / 2} ${y + size.height / 2})`}>
              <text
                class="cell-layout-module-label"
                x={stackedLabel ? 0 : -labelWidth / 2 + textWidth / 2}
                y={stackedLabel ? -1.85 : 0}
                text-anchor="middle"
                dominant-baseline="central"
              >
                {countLabel}
              </text>
              <svg
                class="cell-layout-module-icon"
                x={stackedLabel ? -1.65 : labelWidth / 2 - 3.3}
                y={stackedLabel ? -0.4 : -1.65}
                width="3.3"
                height="3.3"
                viewBox={`${spriteX} ${spriteY} 32 32`}
                aria-hidden="true"
              >
                <image href={url} width={sheetWidth} height={sheetHeight} />
              </svg>
            </g>
          </g>
        );
      })}
      <ConnectionArrows arrows={[...arrows].map(([id, arrow]) => ({ id, ...arrow }))} />
    </svg>
  );
}
