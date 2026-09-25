import type { FactoryModule } from '../../compute/modules.ts';
import type { Position } from '../../bp/decode.ts';
import type { ResourceId } from '../../types.ts';
import type { SpringLinks, SpringPlacement } from './spring-layout.ts';
import { portPoint } from './spring-layout.ts';
import { INPUT_STATION_BOUNDS, OUTPUT_STATION_BOUNDS } from './station-footprint.tsx';

const WIDTH = 192;
const HEIGHT = 128;
const MARGIN = 5;
const GAP = 5;
const UNREACHABLE = 30_000;

function resourcesOf(rates: Record<ResourceId, number>): ResourceId[] {
  return Object.keys(rates) as ResourceId[];
}

function cell(x: number, y: number): number {
  return y * WIDTH + x;
}

function mark(blocked: Uint8Array, left: number, top: number, right: number, bottom: number) {
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(HEIGHT, Math.ceil(bottom)); y++) {
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(WIDTH, Math.ceil(right)); x++) {
      blocked[cell(x, y)] = 1;
    }
  }
}

function occupiedTiles(placed: readonly SpringPlacement[], links: SpringLinks): Uint8Array {
  const blocked = new Uint8Array(WIDTH * HEIGHT);
  mark(blocked, 0, 0, WIDTH, MARGIN);
  mark(blocked, 0, HEIGHT - MARGIN, WIDTH, HEIGHT);
  mark(blocked, 0, 0, MARGIN, HEIGHT);
  mark(blocked, WIDTH - MARGIN, 0, WIDTH, HEIGHT);
  for (const [x, y] of [
    [0, 0],
    [WIDTH - 15, 0],
    [0, HEIGHT - 15],
    [WIDTH - 15, HEIGHT - 15],
  ])
    mark(blocked, x!, y!, x! + 15, y! + 15);
  const reserveStations = (stops: readonly Position[], side: 'input' | 'output') => {
    if (!stops.length) return;
    const bounds = side === 'input' ? INPUT_STATION_BOUNDS : OUTPUT_STATION_BOUNDS;
    const top = Math.min(...stops.map((stop) => stop.y + bounds.top));
    const bottom = Math.max(...stops.map((stop) => stop.y + bounds.bottom));
    const left = side === 'input' ? 0 : Math.min(...stops.map((stop) => stop.x + bounds.left)) - 8;
    const right =
      side === 'input' ? Math.max(...stops.map((stop) => stop.x + bounds.right)) + 8 : WIDTH;
    mark(blocked, left, top, right, bottom);
  };
  reserveStations(links.inputStationStops, 'input');
  reserveStations(links.outputStationStops, 'output');
  for (const placement of placed) {
    mark(
      blocked,
      placement.x - GAP,
      placement.y - GAP,
      placement.x + placement.module.size.width + GAP,
      placement.y + placement.module.size.height + GAP,
    );
  }
  return blocked;
}

function distances(blocked: Uint8Array, sources: readonly Position[]): Int32Array {
  const result = new Int32Array(WIDTH * HEIGHT).fill(UNREACHABLE);
  const queue = new Int32Array(WIDTH * HEIGHT);
  let tail = 0;
  for (const source of sources) {
    const x = Math.round(source.x);
    const y = Math.round(source.y);
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
    const index = cell(x, y);
    if (blocked[index] || result[index] === 0) continue;
    result[index] = 0;
    queue[tail++] = index;
  }
  for (let head = 0; head < tail; head++) {
    const index = queue[head]!;
    const x = index % WIDTH;
    const y = Math.floor(index / WIDTH);
    for (const neighbor of [
      x > 0 ? index - 1 : -1,
      x < WIDTH - 1 ? index + 1 : -1,
      y > 0 ? index - WIDTH : -1,
      y < HEIGHT - 1 ? index + WIDTH : -1,
    ]) {
      if (neighbor < 0 || blocked[neighbor] || result[neighbor] !== UNREACHABLE) continue;
      result[neighbor] = result[index]! + 1;
      queue[tail++] = neighbor;
    }
  }
  return result;
}

function occupancyPrefix(blocked: Uint8Array): Int32Array {
  const stride = WIDTH + 1;
  const prefix = new Int32Array(stride * (HEIGHT + 1));
  for (let y = 0; y < HEIGHT; y++) {
    let row = 0;
    for (let x = 0; x < WIDTH; x++) {
      row += blocked[cell(x, y)]!;
      prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1]! + row;
    }
  }
  return prefix;
}

function isClear(prefix: Int32Array, x: number, y: number, width: number, height: number): boolean {
  const stride = WIDTH + 1;
  const right = x + width;
  const bottom = y + height;
  return (
    prefix[bottom * stride + right]! -
      prefix[y * stride + right]! -
      prefix[bottom * stride + x]! +
      prefix[y * stride + x]! ===
    0
  );
}

function outputSources(
  resource: ResourceId,
  placed: readonly SpringPlacement[],
  links: SpringLinks,
): Position[] {
  const sources: Position[] = [];
  for (const link of links.stationConnections) {
    if (link.side !== 'input' || link.resource !== resource) continue;
    const stop = links.inputStationStops[link.stationIndex];
    if (stop) sources.push({ x: stop.x + INPUT_STATION_BOUNDS.right + 9, y: stop.y + 4.5 });
  }
  for (const placement of placed) {
    if (!(placement.module.outputs[resource] > 0)) continue;
    const ports = links.connections
      .filter((link) => link.producerId === placement.module.id && link.resource === resource)
      .map((link) => ({
        point: portPoint(placement, link.producerPort),
        edge: link.producerPort.edge,
      }));
    if (ports.length)
      sources.push(
        ...ports.map(({ point, edge }) => ({
          x: point.x + (edge === 'left' ? -GAP - 1 : edge === 'right' ? GAP + 1 : 0),
          y: point.y + (edge === 'top' ? -GAP - 1 : edge === 'bottom' ? GAP + 1 : 0),
        })),
      );
    else
      sources.push({ x: placement.x + placement.module.size.width / 2, y: placement.y - GAP - 1 });
  }
  return sources;
}

function inputPoint(
  module: FactoryModule,
  x: number,
  y: number,
  resource: ResourceId,
  links: SpringLinks,
): Position {
  const port =
    links.connections.find((link) => link.consumerId === module.id && link.resource === resource)
      ?.consumerPort ??
    links.stationConnections.find(
      (link) => link.moduleId === module.id && link.resource === resource && link.side === 'input',
    )?.modulePort;
  if (!port) return { x: x + module.size.width / 2, y: y + module.size.height + GAP + 1 };
  const point = portPoint({ module, x, y }, port);
  return {
    x: point.x + (port.edge === 'left' ? -GAP - 1 : port.edge === 'right' ? GAP + 1 : 0),
    y: point.y + (port.edge === 'top' ? -GAP - 1 : port.edge === 'bottom' ? GAP + 1 : 0),
  };
}

/** Place source regions, then expand through available resources on the free tile grid. */
export function preLayoutModules(
  modules: readonly FactoryModule[],
  links: SpringLinks,
  zeroInputRegionRecipes: ReadonlySet<string> = new Set(),
): SpringPlacement[] {
  const remaining = [...modules];
  const placed: SpringPlacement[] = [];
  const available = new Set(
    links.stationConnections.filter((link) => link.side === 'input').map((link) => link.resource),
  );
  const stationFront = links.inputStationStops.length
    ? Math.ceil(
        Math.max(...links.inputStationStops.map((stop) => stop.x + INPUT_STATION_BOUNDS.right)) + 9,
      )
    : MARGIN + 3;
  while (remaining.length) {
    const ready = remaining.filter((module) =>
      resourcesOf(module.inputs).every(
        (resource) => !(module.inputs[resource] > 0) || available.has(resource),
      ),
    );
    const candidates = ready.length ? ready : remaining;
    // A split group's zero-input utility is an early seed even when its internal recipes consume
    // one another. Otherwise choose the module with the most available inputs; cycles need a seed.
    const module = [...candidates].sort((a, b) => {
      const aSeed = zeroInputRegionRecipes.has(a.recipe) ? 1 : 0;
      const bSeed = zeroInputRegionRecipes.has(b.recipe) ? 1 : 0;
      const aReady = resourcesOf(a.inputs).filter((resource) => available.has(resource)).length;
      const bReady = resourcesOf(b.inputs).filter((resource) => available.has(resource)).length;
      return bSeed - aSeed || bReady - aReady || a.id.localeCompare(b.id);
    })[0]!;
    const blocked = occupiedTiles(placed, links);
    const prefix = occupancyPrefix(blocked);
    const resources = resourcesOf(module.inputs).filter(
      (resource) => module.inputs[resource] > 0 && available.has(resource),
    );
    const fields = resources.map((resource) =>
      distances(blocked, outputSources(resource, placed, links)),
    );
    const forwardX = Math.max(
      stationFront,
      ...placed
        .filter(({ module: producer }) =>
          resources.some((resource) => producer.outputs[resource] > 0),
        )
        .map(({ module: producer, x }) => x + producer.size.width + GAP),
    );
    let best: { x: number; y: number; score: number } | undefined;
    for (let x = MARGIN; x <= WIDTH - MARGIN - Math.ceil(module.size.width); x += 2) {
      for (let y = MARGIN; y <= HEIGHT - MARGIN - Math.ceil(module.size.height); y += 2) {
        if (!isClear(prefix, x, y, Math.ceil(module.size.width), Math.ceil(module.size.height)))
          continue;
        let score =
          Math.abs(x - forwardX) * 0.5 + Math.max(0, forwardX - x) * 20 + Math.abs(y - 24) * 0.08;
        for (let index = 0; index < resources.length; index++) {
          const point = inputPoint(module, x, y, resources[index]!, links);
          const px = Math.round(point.x);
          const py = Math.round(point.y);
          const distance =
            px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT
              ? fields[index]![cell(px, py)]!
              : UNREACHABLE;
          score += distance === UNREACHABLE ? 500 : distance;
        }
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    // Oversized or overfull designs still appear, rather than silently losing a module.
    const position = best ?? { x: stationFront, y: 24 };
    placed.push({ module, x: position.x, y: position.y, vx: 0, vy: 0 });
    remaining.splice(remaining.indexOf(module), 1);
    for (const resource of resourcesOf(module.outputs)) {
      if (module.outputs[resource] > 0) available.add(resource);
    }
  }
  return placed;
}
