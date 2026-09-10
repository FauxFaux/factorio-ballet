import { describe, expect, it } from 'vitest';
import {
  assemblerColumnLayout,
  beltsPerAssemblerColumn,
  busConnectionTopLane,
  busLayout,
  busLaneLayout,
  stackAssemblerDistricts,
  type AssemblerDistrict,
} from '../src/components/cell/radar-layout.ts';
import type { Recipe, ResourceId } from '../src/types.ts';

describe('assemblerColumnLayout', () => {
  it('wraps assemblers that exceed the radar height into another column', () => {
    const layout = assemblerColumnLayout(3, 3, 34);

    expect(layout.assemblers).toHaveLength(34);
    expect(layout.assemblers[32]).toEqual({ column: 0, row: 32 });
    expect(layout.assemblers[33]).toEqual({ column: 1, row: 0 });
    expect(layout.columnHeights).toEqual([99, 3]);
    expect(layout.height).toBe(99);
    expect(layout.width).toBe(10);
  });

  it('keeps a fitting stack in one column', () => {
    const layout = assemblerColumnLayout(3, 3, 33);

    expect(layout.assemblers[32]).toEqual({ column: 0, row: 32 });
    expect(layout.width).toBe(3);
  });

  it('reserves belt space around and between assembler columns', () => {
    const layout = assemblerColumnLayout(3, 3, 34, 7, 3);

    expect(layout.inputBeltsPerColumn).toBe(4);
    expect(layout.outputBeltsPerColumn).toBe(2);
    expect(layout.inputBeltGap).toBe(1);
    expect(layout.outputBeltGap).toBe(1);
    expect(layout.columnGap).toBe(8);
    expect(layout.width).toBe(22);
  });

  it('reserves one cell between each belt bank and a single assembler column', () => {
    const layout = assemblerColumnLayout(3, 3, 1, 2, 1);

    expect(layout.width).toBe(8);
  });

  it('reserves fluid pipes inside the item belt banks', () => {
    const layout = assemblerColumnLayout(3, 3, 1, 2, 1, 2, 1);

    expect(layout.inputTransportWidth).toBe(4);
    expect(layout.outputTransportWidth).toBe(2);
    expect(layout.width).toBe(11);
  });
});

function recipe(ingredients: ResourceId[], products: ResourceId[]): Recipe {
  return {
    ingredients: ingredients.map((resource) => ({ resource, amount: 1 })),
    products: products.map((resource) => ({ resource, amount: { fixed: 1 }, probability: 1 })),
    duration: 1,
    categories: [],
  };
}

function district(recipeData: Recipe): AssemblerDistrict {
  return {
    id: 'test',
    recipeId: 'test',
    recipeName: 'Test',
    recipe: recipeData,
    machineWidth: 3,
    machineHeight: 3,
    count: 1,
    inputItemRate: 0,
    outputItemRate: 0,
    inputFlows: [],
    inputFluids: [],
    outputFlows: [],
    outputFluids: [],
  };
}

describe('beltsPerAssemblerColumn', () => {
  it('rounds a district item flow up after spreading it over assembler columns', () => {
    expect(beltsPerAssemblerColumn(91 / 15, 2)).toBe(4);
    expect(beltsPerAssemblerColumn(0, 2)).toBe(0);
  });
});

describe('stackAssemblerDistricts', () => {
  it('stacks adjacent districts joined by an exclusive hand-off', () => {
    const plate = recipe(['item:ore'], ['item:plate']);
    const gear = recipe(['item:plate'], ['item:gear']);

    const stacks = stackAssemblerDistricts([district(plate), district(gear)]);

    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ width: 3, height: 8 });
    expect(stacks[0]?.districts.map(({ y }) => y)).toEqual([0, 5]);
  });

  it('starts a new stack when the two-cell recipe gap would exceed its height', () => {
    const plate = district(recipe(['item:ore'], ['item:plate']));
    const gear = district(recipe(['item:plate'], ['item:gear']));
    plate.count = 17;
    gear.count = 16;

    expect(stackAssemblerDistricts([plate, gear])).toHaveLength(2);
  });

  it('extends only externally supplied input belts through the full stack', () => {
    const plate = district(recipe(['item:ore'], ['item:plate']));
    plate.inputFlows = [{ resource: 'item:ore', rate: 15 }];
    plate.outputFlows = [{ resource: 'item:plate', rate: 30 }];
    const gear = district(recipe(['item:plate', 'item:coal'], ['item:gear']));
    gear.inputFlows = [
      { resource: 'item:plate', rate: 30 },
      { resource: 'item:coal', rate: 16 },
    ];

    const [stack] = stackAssemblerDistricts([plate, gear], 15);

    expect(stack?.externalInputBelts).toBe(3);
    expect(stack?.districts.map(({ layout }) => layout.inputBeltsPerColumn)).toEqual([3, 3]);
  });

  it('routes every stacked district around the widest assembler', () => {
    const plate = district(recipe(['item:ore'], ['item:plate']));
    plate.machineWidth = 5;
    const gear = district(recipe(['item:plate'], ['item:gear']));
    gear.machineWidth = 3;

    const [stack] = stackAssemblerDistricts([plate, gear]);

    expect(stack?.districts.map(({ layout }) => layout.machineWidth)).toEqual([5, 5]);
    expect(stack?.districts.map(({ layout }) => layout.width)).toEqual([5, 5]);
  });

  it('reserves one shared pipe per externally supplied fluid type', () => {
    const steam = district(recipe(['fluid:water'], ['fluid:steam']));
    steam.inputFluids = ['fluid:water'];
    steam.outputFlows = [{ resource: 'fluid:steam', rate: 100 }];
    steam.outputFluids = ['fluid:steam'];
    const process = district(recipe(['fluid:steam', 'fluid:lubricant'], ['item:result']));
    process.inputFluids = ['fluid:steam', 'fluid:lubricant'];

    const [stack] = stackAssemblerDistricts([steam, process], 15);

    expect(stack?.externalInputPipes).toBe(2);
    expect(stack?.districts.map(({ layout }) => layout.inputPipesPerColumn)).toEqual([2, 2]);
  });

  it('does not stack when the hand-off has another producer or consumer', () => {
    const plate = recipe(['item:ore'], ['item:plate']);
    const recycledPlate = recipe(['item:scrap'], ['item:plate']);
    const gear = recipe(['item:plate'], ['item:gear']);

    expect(
      stackAssemblerDistricts([district(plate), district(gear), district(recycledPlate)]),
    ).toHaveLength(3);
    expect(
      stackAssemblerDistricts([
        district(plate),
        district(gear),
        district(recipe(['item:plate'], ['item:rod'])),
      ]),
    ).toHaveLength(3);
  });
});

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
