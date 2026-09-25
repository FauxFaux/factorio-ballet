import type { Position } from '../../bp/decode.ts';
import type { FactoryModule } from '../../compute/modules.ts';
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
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
): SpringPlacement[] {
  const indexById = new Map(placements.map((placement, index) => [placement.module.id, index]));
  const forces = placements.map(() => ({ x: 0, y: 0 }));
  const center = (placement: SpringPlacement) => ({
    x: placement.x + placement.module.size.width / 2,
    y: placement.y + placement.module.size.height / 2,
  });
  const pull = (index: number, dx: number, dy: number, rest: number, k: number) => {
    const distance = Math.hypot(dx, dy) || 1;
    const force = (k * (distance - rest)) / distance;
    forces[index]!.x += dx * force;
    forces[index]!.y += dy * force;
  };

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
    const rest = (a.module.size.width + b.module.size.width) / 2 + GAP + 4;
    const k = strength(link.resource, link.rate);
    pull(from, dx, dy, rest, k);
    pull(to, -dx, -dy, rest, k);
  }

  for (const link of links.stationConnections) {
    const index = indexById.get(link.moduleId);
    const stop = (link.side === 'input' ? links.inputStationStops : links.outputStationStops)[
      link.stationIndex
    ];
    if (index === undefined || !stop) continue;
    const module = placements[index]!;
    const point = center(module);
    const anchor = {
      x: stop.x + (link.side === 'input' ? 8 : -8),
      y: stop.y + 4,
    };
    pull(
      index,
      anchor.x - point.x,
      anchor.y - point.y,
      module.module.size.width / 2 + 12,
      strength(link.resource, link.rate),
    );
  }

  const next = placements.map((placement, index) => {
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
        first.x += (sign * overlapX) / 2;
        second.x -= (sign * overlapX) / 2;
        first.vx = second.vx = 0;
      } else {
        const sign = ac.y <= bc.y ? -1 : 1;
        first.y += (sign * overlapY) / 2;
        second.y -= (sign * overlapY) / 2;
        first.vy = second.vy = 0;
      }
    }
  }
  return next;
}
