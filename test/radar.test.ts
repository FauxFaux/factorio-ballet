import { describe, expect, it } from 'vitest';
import {
  busConnectionTopLane,
  busLayout,
  busLaneLayout,
} from '../src/components/cell/radar-layout.ts';

describe('busLaneLayout', () => {
  it('routes resources from imports through their last consumer and exports from their producer', () => {
    const bus = busLayout(
      [
        {
          id: 'column:first',
          inputs: [
            { resource: 'item:a', rate: 10 },
            { resource: 'item:b', rate: 10 },
          ],
          outputs: [{ resource: 'item:c', rate: 10, districtId: 'make-c' }],
        },
        {
          id: 'column:second',
          inputs: [{ resource: 'item:c', rate: 10, districtId: 'use-c' }],
          outputs: [{ resource: 'item:d', rate: 10 }],
        },
        {
          inputs: [
            { resource: 'item:b', rate: 10 },
            { resource: 'item:d', rate: 10 },
          ],
          outputs: [{ resource: 'item:e', rate: 10 }],
        },
      ],
      ['item:a', 'item:b'],
      ['item:e'],
      15,
    );
    const lanes = bus.lanes;

    expect(lanes.map(({ resource, start, end }) => ({ resource, start, end }))).toEqual([
      { resource: 'item:b', start: 0, end: 3 },
      { resource: 'item:b', start: 0, end: 3 },
      { resource: 'item:a', start: 0, end: 1 },
      { resource: 'item:c', start: 1, end: 2 },
      { resource: 'item:d', start: 2, end: 3 },
      { resource: 'item:e', start: 3, end: 4 },
    ]);
    expect(lanes.map(({ lane }) => lane)).toEqual([0, 1, 2, 2, 2, 0]);
    expect(
      busConnectionTopLane(lanes, [{ resource: 'item:a' }, { resource: 'item:b' }], 'belt'),
    ).toBe(2);
    expect(busConnectionTopLane(lanes, [{ resource: 'item:c' }], 'belt')).toBe(2);
    expect(busConnectionTopLane(lanes, [{ resource: 'item:missing' }], 'belt')).toBeUndefined();
    expect(bus.routes.find(({ resource }) => resource === 'item:c')).toMatchObject({
      id: 'bus:item:c',
      throughput: 10,
      laneCount: 1,
      connections: [
        {
          id: 'bus:item:c:produce:1',
          kind: 'produce',
          busDirection: 'onto-bus',
          column: 1,
          columnId: 'column:first',
          districtIds: ['make-c'],
          rate: 10,
        },
        {
          id: 'bus:item:c:consume:2',
          kind: 'consume',
          busDirection: 'off-bus',
          column: 2,
          columnId: 'column:second',
          districtIds: ['use-c'],
          rate: 10,
        },
      ],
    });
    expect(lanes.find(({ resource }) => resource === 'item:c')).toMatchObject({
      id: 'bus:item:c:lane:0',
      routeId: 'bus:item:c',
      routeLane: 0,
    });
    expect(bus.routes.find(({ resource }) => resource === 'item:a')?.connections[0]).toMatchObject({
      kind: 'import',
      busDirection: 'onto-bus',
      stationId: 'station:import:item:a',
      stationIndex: 0,
    });
    expect(
      bus.routes.find(({ resource }) => resource === 'item:e')?.connections.at(-1),
    ).toMatchObject({
      kind: 'export',
      busDirection: 'off-bus',
      stationId: 'station:export:item:e',
      stationIndex: 0,
    });
  });

  it('uses one reusable pipe lane for each fluid regardless of throughput', () => {
    const lanes = busLaneLayout(
      [
        {
          inputs: [{ resource: 'fluid:water', rate: 1_000 }],
          outputs: [{ resource: 'fluid:steam', rate: 1_000 }],
        },
        {
          inputs: [{ resource: 'fluid:steam', rate: 1_000 }],
          outputs: [],
        },
      ],
      ['fluid:water'],
      [],
      15,
    );

    expect(lanes).toMatchObject([
      { resource: 'fluid:water', transport: 'pipe', lane: 0, start: 0, end: 1 },
      { resource: 'fluid:steam', transport: 'pipe', lane: 0, start: 1, end: 2 },
    ]);
  });
});
