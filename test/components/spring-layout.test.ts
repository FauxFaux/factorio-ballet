import { describe, expect, it } from 'vitest';
import type { FactoryModule } from '../../src/compute/modules.ts';
import type { AttachedModuleConnection } from '../../src/compute/module-port-connections.ts';
import {
  initialSpringPlacements,
  stepSpringLayout,
  type SpringLinks,
} from '../../src/components/layout/spring-layout.ts';

function module(id: string): FactoryModule {
  return {
    id,
    recipe: id,
    machineCount: 1,
    copies: 1,
    size: { width: 4, height: 12 },
    ports: [],
    inputs: {},
    outputs: {},
  };
}

const emptyLinks: SpringLinks = {
  connections: [],
  stationConnections: [],
  inputStationStops: [],
  outputStationStops: [],
};

function link(
  resource: AttachedModuleConnection['resource'],
  rate: number,
): AttachedModuleConnection {
  const port = { edge: 'top' as const, x: 0, transport: 'belt' as const };
  return {
    producerId: 'A',
    consumerId: 'B',
    resource,
    rate,
    producerPort: port,
    consumerPort: port,
  };
}

describe('spring layout', () => {
  it('retains existing positions when the module list changes', () => {
    const initial = initialSpringPlacements([module('A')]);
    initial[0]!.x = 42.5;
    const next = initialSpringPlacements([module('A'), module('B')], initial);
    expect(next[0]!.x).toBe(42.5);
    expect(next[1]!.x).toBeGreaterThan(8);
  });

  it('pulls connected modules incrementally, with higher item rates stronger', () => {
    const placed = initialSpringPlacements([module('A'), module('B')]);
    placed[1]!.x = 80;
    const slow = stepSpringLayout(placed, { ...emptyLinks, connections: [link('item:iron', 1)] });
    const fast = stepSpringLayout(placed, { ...emptyLinks, connections: [link('item:iron', 60)] });
    expect(slow[0]!.x).toBeGreaterThan(placed[0]!.x);
    expect(fast[0]!.x).toBeGreaterThan(slow[0]!.x);
    expect(fast[1]!.x).toBeLessThan(slow[1]!.x);
    expect(placed[0]!.x).toBe(8);
  });

  it('uses an effective rate of 15 for fluid links', () => {
    const placed = initialSpringPlacements([module('A'), module('B')]);
    placed[1]!.x = 80;
    const fluid = stepSpringLayout(placed, {
      ...emptyLinks,
      connections: [link('fluid:water', 1000)],
    });
    const item = stepSpringLayout(placed, { ...emptyLinks, connections: [link('item:iron', 15)] });
    expect(fluid[0]!.x).toBeCloseTo(item[0]!.x);
    expect(fluid[1]!.x).toBeCloseTo(item[1]!.x);
  });

  it('aligns horizontal links at their ports rather than their module centers', () => {
    const placed = initialSpringPlacements([module('A'), module('B')]);
    placed[1]!.x = 80;
    placed[1]!.y = 35;
    const before = placed[1]!.y + 12 - placed[0]!.y;
    const next = stepSpringLayout(placed, {
      ...emptyLinks,
      connections: [
        {
          ...link('item:iron', 15),
          consumerPort: { edge: 'bottom', x: 0, transport: 'belt' },
        },
      ],
    });
    expect(Math.abs(next[1]!.y + 12 - next[0]!.y)).toBeLessThan(Math.abs(before));
  });

  it('aligns vertical links at their ports', () => {
    const placed = initialSpringPlacements([module('A'), module('B')]);
    placed[1]!.x = 12;
    placed[1]!.y = 80;
    const next = stepSpringLayout(placed, {
      ...emptyLinks,
      connections: [link('item:iron', 15)],
    });
    expect(Math.abs(next[1]!.x - next[0]!.x)).toBeLessThan(4);
  });

  it('lets station links guide both axes gently', () => {
    const placed = initialSpringPlacements([module('A')]);
    placed[0]!.x = 80;
    const withoutStation = stepSpringLayout(placed, emptyLinks)[0]!;
    const withStation = stepSpringLayout(placed, {
      ...emptyLinks,
      inputStationStops: [{ x: 2, y: 50 }],
      stationConnections: [
        {
          stationId: 'input',
          stationIndex: 0,
          moduleId: 'A',
          resource: 'item:iron',
          rate: 15,
          side: 'input',
          modulePort: { edge: 'top', x: 0, transport: 'belt' },
        },
      ],
    })[0]!;
    expect(withStation.x).toBeLessThan(withoutStation.x);
    expect(withStation.y).toBeGreaterThan(withoutStation.y);
    expect(withoutStation.x - withStation.x).toBeLessThan(0.25);
    expect(withStation.y - withoutStation.y).toBeLessThan(0.25);
  });

  it('pulls a module toward a connected fixed station and separates overlapping modules', () => {
    const placed = initialSpringPlacements([module('A'), module('B')]);
    placed[0]!.x = 80;
    placed[1]!.x = 80;
    const next = stepSpringLayout(placed, {
      ...emptyLinks,
      inputStationStops: [{ x: 2, y: 26 }],
      stationConnections: [
        {
          stationId: 'input',
          stationIndex: 0,
          moduleId: 'A',
          resource: 'item:iron',
          rate: 15,
          side: 'input',
          modulePort: { edge: 'top', x: 0, transport: 'belt' },
        },
      ],
    });
    expect(next[0]!.x).toBeLessThan(80);
    expect(Math.abs(next[0]!.x - next[1]!.x)).toBeGreaterThanOrEqual(9);
  });
});
