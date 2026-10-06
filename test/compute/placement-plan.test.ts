import { describe, expect, it } from 'vitest';
import { planCellPlacements, placementPlanScore } from '../../src/compute/placement-plan/search.ts';
import { powerSplits, recipeCandidates } from '../../src/compute/placement-plan/candidates.ts';
import { placementRecipes } from '../../src/compute/placement-plan/recipes.ts';
import { searchModuleFlows } from '../../src/compute/placement-plan/flow-search.ts';
import type { PlacementDemand } from '../../src/compute/placement-plan/recipes.ts';
import type { KernelLayoutOption } from '../../src/compute/kernel-layout-options.ts';
import type { ResourceId } from '../../src/types.ts';
import { connectStationFlows } from '../../src/compute/module-connections.ts';
import { assignModulePorts } from '../../src/compute/module-port-connections.ts';

function demand(
  recipe: string,
  count: number,
  capacity: number,
  inputs: Partial<Record<ResourceId, number>>,
  outputs: Partial<Record<ResourceId, number>>,
  step = 1,
): PlacementDemand {
  const split = (rates: Partial<Record<ResourceId, number>>) => ({
    solids: Object.fromEntries(
      Object.entries(rates)
        .filter(([id]) => id.startsWith('item:'))
        .map(([id, rate]) => [id, rate!]),
    ),
    fluids: Object.fromEntries(
      Object.entries(rates)
        .filter(([id]) => id.startsWith('fluid:'))
        .map(([id, rate]) => [id, rate!]),
    ),
  });
  const boundary = Object.entries({ ...inputs, ...outputs }).map(([resource, rate], x) =>
    resource.startsWith('fluid:')
      ? { x, kind: 'pipe' as const, resource }
      : {
          x,
          kind: 'belt' as const,
          lanes: { left: resource },
          laneFlows: {
            left: {
              side: inputs[resource as ResourceId] ? ('input' as const) : ('output' as const),
              rate: rate! * step,
            },
          },
        },
  );
  const option: KernelLayoutOption = {
    name: 'fixture',
    requestedCopies: capacity / step,
    buildingsPerRepeat: step,
    maxBuildingsPerColumn: capacity,
    columns: [],
    result: {
      status: 'found',
      optimal: true,
      stopReason: 'complete',
      diagnostics: {
        exploredStates: 1,
        capacityRejections: 0,
        validationRejections: 0,
        scope: 'one-machine/external-items/straight-surface-trunks',
      },
      validation: { valid: true, issues: [], supportedCopies: capacity / step },
      candidate: {
        width: boundary.length + 3,
        pitch: 4,
        machineIds: Object.fromEntries(Array.from({ length: step }, (_, i) => [i, recipe])),
        lanes: [],
        transfers: [],
        fluids: [],
        boundary,
        column: {
          entities: boundary.flatMap((track) =>
            [0, 3].map((y) =>
              track.kind === 'pipe'
                ? { kind: 'pipe' as const, position: { x: track.x, y } }
                : {
                    kind: 'belt' as const,
                    direction: 'north' as const,
                    position: { x: track.x, y },
                  },
            ),
          ),
        },
      },
    },
  };
  return {
    problem: {
      inputs: split(inputs),
      outputs: split(outputs),
      assemblers: [{ name: recipe, inputPerSecond: {}, outputPerSecond: {} }],
      design: { columns: [] },
    },
    machineCount: count,
    options: [option],
  };
}

function processingCell(): PlacementDemand[] {
  return [
    demand(
      'processing-unit',
      23.999999999999993,
      16,
      { 'item:electronic-circuit': 7, 'item:advanced-circuit': 0.7, 'fluid:sulfuric-acid': 1.75 },
      { 'item:processing-unit': 0.7 },
    ),
    demand(
      'advanced-circuit',
      14.399999999999999,
      16,
      { 'item:copper-cable': 7 / 3, 'item:electronic-circuit': 7 / 6, 'item:plastic-bar': 7 / 6 },
      { 'item:advanced-circuit': 7 / 6 },
    ),
    demand(
      'electronic-circuit',
      13.200000000000003,
      8,
      { 'item:copper-cable': 21, 'item:iron-plate': 7 },
      { 'item:electronic-circuit': 14 },
    ),
    demand(
      'casting-copper-cable',
      10.7617728531856,
      8,
      { 'fluid:molten-copper': 38 },
      { 'item:copper-cable': 28.88 },
    ),
    demand(
      'casting-iron',
      10.238227146814406,
      9,
      { 'fluid:molten-iron': 47.5 },
      { 'item:iron-plate': 9.025 },
    ),
  ];
}

function checkConservation(
  demands: PlacementDemand[],
  plan: ReturnType<typeof planCellPlacements>,
) {
  for (const row of demands) {
    const modules = plan.modules.filter(
      (module) => module.recipe === row.problem.assemblers[0].name,
    );
    expect(modules.reduce((sum, module) => sum + module.machineCount, 0)).toBe(
      Math.max(1, Math.ceil(row.machineCount! - 1e-8)),
    );
    expect(modules.reduce((sum, module) => sum + module.workload!, 0)).toBeCloseTo(
      row.machineCount!,
      8,
    );
    for (const module of modules) {
      expect(module.workload).toBeGreaterThan(0);
      expect(module.workload!).toBeLessThanOrEqual(module.machineCount + 1e-8);
    }
    for (const side of ['inputs', 'outputs'] as const) {
      for (const [resource, rate] of Object.entries({
        ...row.problem[side].solids,
        ...row.problem[side].fluids,
      })) {
        expect(
          modules.reduce((sum, module) => sum + module[side][resource as ResourceId], 0),
        ).toBeCloseTo(rate * row.machineCount!, 8);
      }
    }
  }
  for (const module of plan.modules) {
    for (const [side, remainders] of [
      ['inputs', plan.flows.unmetInputs],
      ['outputs', plan.flows.unusedOutputs],
    ] as const) {
      for (const [resource, rate] of Object.entries(module[side])) {
        const internal = plan.flows.connections
          .filter(
            (flow) =>
              flow.resource === resource &&
              (side === 'inputs' ? flow.consumerId : flow.producerId) === module.id,
          )
          .reduce((sum, flow) => sum + flow.rate, 0);
        const external = remainders
          .filter((flow) => flow.moduleId === module.id && flow.resource === resource)
          .reduce((sum, flow) => sum + flow.rate, 0);
        expect(internal + external).toBeCloseTo(rate, 8);
      }
    }
  }
}

describe('planCellPlacements', () => {
  it('reduces coupling in the processing-unit cell without extra placements or buildings', () => {
    const demands = processingCell();
    const plan = planCellPlacements(demands, 75);
    checkConservation(demands, plan);
    // The balanced 7+7 circuit plan needs 4 circuit, 4 cable, 3 iron, and 2 advanced-circuit handoffs.
    expect(plan.flows.connections.length).toBeLessThanOrEqual(11);
    expect(
      plan.flows.connections.filter((flow) => flow.resource === 'item:electronic-circuit'),
    ).toHaveLength(3);
    expect(
      plan.flows.connections.some((flow) => {
        const producer = plan.modules.find((module) => module.id === flow.producerId)!;
        const consumer = plan.modules.find((module) => module.id === flow.consumerId)!;
        return (
          Math.abs(flow.rate - producer.outputs[flow.resource]) < 1e-8 &&
          Math.abs(flow.rate - consumer.inputs[flow.resource]) < 1e-8
        );
      }),
    ).toBe(true);
    expect(plan.modules).toHaveLength(9);
    const stations = connectStationFlows(
      plan.flows,
      ['fluid:sulfuric-acid', 'item:plastic-bar', 'fluid:molten-copper', 'fluid:molten-iron'],
      ['item:processing-unit'],
    );
    expect(stations.unmetInputs).toEqual([]);
    expect(stations.unusedOutputs).toEqual([]);
    expect(assignModulePorts(plan.modules, stations).unattached).toEqual([]);
  });

  it('enumerates the four power expansions of nine with one singleton remainder', () => {
    expect([...powerSplits(9)]).toEqual([
      [8, 1],
      [4, 4, 1],
      [4, 2, 2, 1],
      [2, 2, 2, 2, 1],
    ]);
  });

  it('matches an independent full product evaluation of its candidate sets', () => {
    const demands = [
      demand('producer', 8.4, 6, {}, { 'item:plate': 2 }),
      demand('consumer', 5.6, 4, { 'item:plate': 3 }, {}),
    ];
    const plan = planCellPlacements(demands, 75);
    const recipes = placementRecipes(demands, 75);
    const candidates = recipes.map((recipe) =>
      recipeCandidates(
        recipe,
        recipes,
        6,
        plan.diagnostics.maxPlacements - plan.diagnostics.minimumPlacements + recipe.minimum,
      ),
    );
    let minimum = Infinity;
    for (const first of candidates[0])
      for (const second of candidates[1]) {
        const modules = [...first, ...second];
        if (modules.length > plan.diagnostics.maxPlacements) continue;
        minimum = Math.min(
          minimum,
          placementPlanScore(
            modules,
            searchModuleFlows(modules, ['item:plate'], 24).allocation,
            75,
          ),
        );
      }
    expect(plan.score).toBeCloseTo(minimum, 8);
    expect(placementPlanScore(plan.modules, plan.flows, 75)).toBeCloseTo(plan.score, 8);
    expect(plan.diagnostics.stopReason).toBe('complete');
    expect(plan.diagnostics.candidateCombinations).toBe(
      candidates[0].length * candidates[1].length,
    );
    checkConservation(demands, plan);
  });

  it('uses one candidate for each singleton recipe even with fractional workloads', () => {
    const demands = Array.from({ length: 10 }, (_, i) =>
      demand(`utility-${i}`, 0.13, 4, {}, { [`item:utility-${i}`]: 1 }),
    );
    const plan = planCellPlacements(demands, 75);
    expect(plan.diagnostics.candidatesPerRecipe).toEqual(Array(10).fill(1));
    expect(plan.diagnostics.candidateCombinations).toBe(1);
    expect(plan.diagnostics.stopReason).toBe('complete');
    checkConservation(demands, plan);
  });

  it('scores a large Cartesian product while reusing its small material networks', () => {
    const demands = Array.from({ length: 10 }, (_, i) =>
      demand(
        `recipe-${i}`,
        25,
        8,
        { [`item:material-${i}`]: 1 },
        { [`item:material-${i + 1}`]: 1 },
      ),
    );
    const plan = planCellPlacements(demands, 75);
    expect(plan.diagnostics.candidateCombinations).toBeGreaterThan(1_000_000);
    expect(plan.diagnostics.stopReason).toBe('complete');
    expect(plan.diagnostics.materialEvaluations).toBeLessThan(1000);
    expect(plan.modules.reduce((sum, module) => sum + module.machineCount, 0)).toBe(250);
    checkConservation(demands, plan);
  });

  it('separates shared station imports into independent material factors', () => {
    const demands = Array.from({ length: 10 }, (_, i) =>
      demand(`recipe-${i}`, 25, 8, { 'item:import': 1 }, { [`item:material-${i}`]: 1 }),
    );
    const plan = planCellPlacements(demands, 75);
    expect(plan.diagnostics.candidateCombinations).toBeGreaterThan(1_000_000);
    expect(plan.diagnostics.stopReason).toBe('complete');
    expect(plan.diagnostics.materialEvaluations).toBeLessThanOrEqual(120);
    expect(placementPlanScore(plan.modules, plan.flows, 75)).toBeCloseTo(plan.score, 8);
    checkConservation(demands, plan);
  });

  it('scores small per-machine rates when aggregate module flows exceed the flow tolerance', () => {
    const demands = [
      demand('producer', 25, 25, {}, { 'item:trace': 1e-9 }),
      demand('consumer', 25, 25, { 'item:trace': 1e-9 }, {}),
    ];
    const plan = planCellPlacements(demands, 75, { maxPlacementMultiplier: 1 });
    expect(plan.flows.connections).toHaveLength(1);
    expect(placementPlanScore(plan.modules, plan.flows, 75)).toBeCloseTo(plan.score, 8);
    checkConservation(demands, plan);
  });

  it('preserves the solved rates and limits at an immediate budget stop', () => {
    const demands = processingCell();
    const plan = planCellPlacements(demands, 75, { maxStates: 1, maxPlacementMultiplier: 1 });
    checkConservation(demands, plan);
    expect(plan.diagnostics).toMatchObject({
      exploredStates: 1,
      stopReason: 'budget',
      optimal: false,
      maxPlacements: 9,
    });
    expect(plan.modules).toHaveLength(9);
  });

  it('can introduce a dedicated remainder without increasing installed capacity', () => {
    const demands = [
      demand('producer', 10, 6, {}, { 'item:plate': 1 }),
      demand('consumer-a', 4, 10, { 'item:plate': 1 }, {}),
      demand('consumer-b', 4, 10, { 'item:plate': 1 }, {}),
      demand('consumer-c', 2, 10, { 'item:plate': 1 }, {}),
    ];
    const plan = planCellPlacements(demands, 75);
    checkConservation(demands, plan);
    expect(
      plan.modules
        .filter((module) => module.recipe === 'producer')
        .map((module) => module.machineCount)
        .sort(),
    ).toEqual([2, 4, 4]);
    expect(plan.flows.connections).toHaveLength(3);
    expect(plan.modules.length).toBeLessThanOrEqual(plan.diagnostics.maxPlacements);
  });

  it('can preserve several dedicated feeds while splitting the remaining producer block', () => {
    const demands = [
      demand('producer', 20, 20, {}, { 'item:plate': 1 }),
      ...Array.from({ length: 5 }, (_, i) =>
        demand(`consumer-${i}`, 4, 4, { 'item:plate': 1 }, {}),
      ),
    ];
    const plan = planCellPlacements(demands, 75);
    checkConservation(demands, plan);
    expect(
      plan.modules
        .filter((module) => module.recipe === 'producer')
        .map((module) => module.machineCount),
    ).toEqual([4, 4, 4, 4, 4]);
    expect(plan.flows.connections).toHaveLength(5);
  });

  it('keeps pair repeats intact and uses an explicit estimate for an odd remainder', () => {
    const demands = [demand('pair', 5.1, 4, {}, { 'item:plate': 1 }, 2)];
    const plan = planCellPlacements(demands, 75);
    checkConservation(demands, plan);
    expect(plan.modules.every((module) => module.machineCount % 2 === 0)).toBe(true);
    const odd = planCellPlacements([{ ...demands[0], machineCount: 4.1 }], 75);
    checkConservation([{ ...demands[0], machineCount: 4.1 }], odd);
    expect(odd.modules.some((module) => module.estimated && module.machineCount === 1)).toBe(true);
  });

  it('supports estimated layouts, cycles, gross returns, and empty or unresolved cells', () => {
    const demands = [
      demand(
        'a',
        2.2,
        4,
        { 'item:plate': 2, 'fluid:water': 1 },
        { 'item:gear': 1, 'fluid:water': 1 },
      ),
      demand('b', 1.1, 4, { 'item:gear': 2 }, { 'item:plate': 4 }),
    ].map((row) => ({ ...row, options: [] }));
    const plan = planCellPlacements(demands, 75);
    checkConservation(demands, plan);
    expect(plan.modules.every((module) => module.estimated)).toBe(true);
    expect(plan.flows.connections.every((flow) => flow.consumerId !== flow.producerId)).toBe(true);
    expect(planCellPlacements([], 75).modules).toEqual([]);
    expect(planCellPlacements([{ ...demands[0], machineCount: undefined }], 75).modules).toEqual(
      [],
    );
  });

  it('keeps very small positive workloads in one building', () => {
    const demands = [demand('tiny', 1e-9, 4, {}, { 'item:plate': 100 })];
    const plan = planCellPlacements(demands, 75);
    checkConservation(demands, plan);
    expect(plan.modules[0].machineCount).toBe(1);
    expect(plan.modules[0].outputs['item:plate']).toBeCloseTo(1e-7, 12);
  });

  it('is deterministic under recipe reordering', () => {
    const demands = processingCell();
    const first = planCellPlacements(demands, 75, { maxStates: 100 });
    expect(planCellPlacements(demands.toReversed(), 75, { maxStates: 100 })).toEqual(first);
  });
});
