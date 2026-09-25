import type { Position } from '../../bp/decode.ts';
import type { FactoryModule } from '../../compute/modules.ts';
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
  ModulePortReference,
} from '../../compute/module-port-connections.ts';

export interface SpringPlacement {
  module: FactoryModule;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SpringLinks {
  connections: readonly AttachedModuleConnection[];
  stationConnections: readonly AttachedStationConnection[];
  inputStationStops: readonly Position[];
  outputStationStops: readonly Position[];
}

const FLUID_RATE = 15;
const GAP = 5;
const DAMPING = 0.78;
const ALIGNMENT = 3;
const STATION_STRENGTH = 0.2;

/** The endpoint used by both the visible link and its alignment force. */
export function portPoint(
  placement: { module: FactoryModule; x: number; y: number },
  port: ModulePortReference,
): Position {
  const leftOffset = port.direction === 'south' ? 0.75 : 0.25;
  const laneOffset =
    port.lane === 'left' ? leftOffset : port.lane === 'right' ? 1 - leftOffset : 0.5;
  return {
    x:
      port.edge === 'left'
        ? placement.x
        : port.edge === 'right'
          ? placement.x + placement.module.size.width
          : placement.x + port.x + laneOffset,
    y:
      port.edge === 'left' || port.edge === 'right'
        ? placement.y + (port.y ?? 0) + 0.5
        : placement.y + (port.edge === 'top' ? 0 : placement.module.size.height),
  };
}

/** Seed new modules in a readable row; retain positions and momentum for existing IDs. */
export function initialSpringPlacements(
  modules: readonly FactoryModule[],
  previous: readonly SpringPlacement[] = [],
): SpringPlacement[] {
  const byId = new Map(previous.map((placement) => [placement.module.id, placement]));
  let nextX = 8;
  return modules.map((module) => {
    const x = nextX;
    const labelWidth = `${module.machineCount}×`.length * 1.25 + 4;
    nextX += Math.max(module.size.width, labelWidth) + 4;
    const prior = byId.get(module.id);
    return prior ? { ...prior, module } : { module, x, y: 26, vx: 0, vy: 0 };
  });
}

function strength(resource: string, rate: number): number {
  const effectiveRate = resource.startsWith('fluid:') ? FLUID_RATE : rate;
  return 0.012 * Math.sqrt(Math.max(0, effectiveRate) / 15);
}

/** Advance one frame. Stations are fixed anchors; modules are movable rectangles. */
export function stepSpringLayout(
  placements: readonly SpringPlacement[],
  links: SpringLinks,
  pinnedModuleId?: string,
): SpringPlacement[] {
  const indexById = new Map(placements.map((placement, index) => [placement.module.id, index]));
  const forces = placements.map(() => ({ x: 0, y: 0 }));
  const center = (placement: SpringPlacement) => ({
    x: placement.x + placement.module.size.width / 2,
    y: placement.y + placement.module.size.height / 2,
  });
  for (const link of links.connections) {
    const from = indexById.get(link.producerId);
    const to = indexById.get(link.consumerId);
    if (from === undefined || to === undefined || from === to) continue;
    const a = placements[from]!;
    const b = placements[to]!;
    const ac = center(a);
    const bc = center(b);
    const dx = bc.x - ac.x;
    const dy = bc.y - ac.y;
    const portA = portPoint(a, link.producerPort);
    const portB = portPoint(b, link.consumerPort);
    const portDx = portB.x - portA.x;
    const portDy = portB.y - portA.y;
    const restX = (a.module.size.width + b.module.size.width) / 2 + GAP + 4;
    const restY = (a.module.size.height + b.module.size.height) / 2 + GAP + 4;
    // Each link can run horizontally or vertically. Penalize sideways port offset so the
    // chosen spring makes its visible line straight without snapping either module to a grid.
    const horizontalCost = (Math.abs(dx) - restX) ** 2 + ALIGNMENT * portDy ** 2;
    const verticalCost = (Math.abs(dy) - restY) ** 2 + ALIGNMENT * portDx ** 2;
    const k = strength(link.resource, link.rate);
    const fx =
      k * (horizontalCost <= verticalCost ? dx - Math.sign(dx || 1) * restX : ALIGNMENT * portDx);
    const fy =
      k * (horizontalCost <= verticalCost ? ALIGNMENT * portDy : dy - Math.sign(dy || 1) * restY);
    forces[from]!.x += fx;
    forces[from]!.y += fy;
    forces[to]!.x -= fx;
    forces[to]!.y -= fy;
  }

  for (const link of links.stationConnections) {
    const index = indexById.get(link.moduleId);
    const stop = (link.side === 'input' ? links.inputStationStops : links.outputStationStops)[
      link.stationIndex
    ];
    if (index === undefined || !stop) continue;
    const module = placements[index]!;
    const point = center(module);
    const anchorX = stop.x + (link.side === 'input' ? 8 : module.x < stop.x ? -8 : -4);
    const anchorY = stop.y + (link.side === 'input' ? 4.5 : 4);
    const port = portPoint(module, link.modulePort);
    const restX = module.module.size.width / 2 + 12;
    const k = strength(link.resource, link.rate) * STATION_STRENGTH;
    forces[index]!.x += k * (anchorX + (link.side === 'input' ? restX : -restX) - point.x);
    forces[index]!.y += k * ALIGNMENT * (anchorY - port.y);
  }

  const next = placements.map((placement, index) => {
    if (placement.module.id === pinnedModuleId) return { ...placement, vx: 0, vy: 0 };
    // A weak centre pull keeps disconnected modules in the working area.
    const point = center(placement);
    const vx = Math.max(
      -3,
      Math.min(3, (placement.vx + forces[index]!.x + (96 - point.x) * 0.0005) * DAMPING),
    );
    const vy = Math.max(
      -3,
      Math.min(3, (placement.vy + forces[index]!.y + (64 - point.y) * 0.0005) * DAMPING),
    );
    return { ...placement, x: placement.x + vx, y: placement.y + vy, vx, vy };
  });

  // Resolve rectangle intersections after moving, so strong links cannot stack footprints.
  for (let a = 0; a < next.length; a++) {
    for (let b = a + 1; b < next.length; b++) {
      const first = next[a]!;
      const second = next[b]!;
      const ac = center(first);
      const bc = center(second);
      const overlapX =
        (first.module.size.width + second.module.size.width) / 2 + GAP - Math.abs(ac.x - bc.x);
      const overlapY =
        (first.module.size.height + second.module.size.height) / 2 + GAP - Math.abs(ac.y - bc.y);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX < overlapY) {
        const sign = ac.x <= bc.x ? -1 : 1;
        const firstPinned = first.module.id === pinnedModuleId;
        const secondPinned = second.module.id === pinnedModuleId;
        first.x += firstPinned ? 0 : (sign * overlapX) / (secondPinned ? 1 : 2);
        second.x -= secondPinned ? 0 : (sign * overlapX) / (firstPinned ? 1 : 2);
        first.vx = second.vx = 0;
      } else {
        const sign = ac.y <= bc.y ? -1 : 1;
        const firstPinned = first.module.id === pinnedModuleId;
        const secondPinned = second.module.id === pinnedModuleId;
        first.y += firstPinned ? 0 : (sign * overlapY) / (secondPinned ? 1 : 2);
        second.y -= secondPinned ? 0 : (sign * overlapY) / (firstPinned ? 1 : 2);
        first.vy = second.vy = 0;
      }
    }
  }
  return next;
}
