import { describe, expect, it } from 'vitest';
import { assemblerProblem, type KernelProblem } from '../../../src/compute/kernel-problems.ts';
import { normalizeTileDesignInput } from '../../../src/compute/tile-design/problem.ts';
import type { TileDesignOptions } from '../../../src/compute/tile-design/types.ts';
import { isError } from '../../../src/compute/tile-design/validation.ts';

const options: TileDesignOptions = {
  transport: {
    beltLaneCapacity: 15,
    undergroundBeltReach: 4,
    undergroundPipeReach: 10,
    inserters: [{ id: 'ordinary', capacity: 3, reach: 1 }],
    fluidThroughput: 'unlimited',
  },
  envelope: { maxWidth: 12, maxPitch: 10, primitives: ['surface'], maxStates: 1000 },
};

function normalized(problem: KernelProblem, overrides: Partial<TileDesignOptions> = {}) {
  const result = normalizeTileDesignInput(problem, { ...options, ...overrides });
  expect(result.success).toBe(true);
  if (isError(result)) throw new Error(result.message);
  return result.input;
}

describe('normalizeTileDesignInput', () => {
  it('lists one meaningful orientation for a square machine without fluid connections', () => {
    const machine = normalized(assemblerProblem({ solidInputs: [1] })).machines[0]!;
    expect(machine.orientations).toEqual([{ rotation: 'north', mirrored: false }]);
  });

  it('allows every cardinal rotation for a rectangular machine', () => {
    const machine = normalized(
      assemblerProblem({ solidInputs: [1], size: { width: 2, height: 3 } }),
    ).machines[0]!;
    expect(machine.orientations).toEqual([
      { rotation: 'north', mirrored: false },
      { rotation: 'east', mirrored: false },
      { rotation: 'south', mirrored: false },
      { rotation: 'west', mirrored: false },
    ]);
  });

  it('allows each rotation and its mirror when a machine has fluid connections', () => {
    const machine = normalized(assemblerProblem({ fluidInputs: [1], fluidOutputs: [1] }))
      .machines[0]!;
    expect(machine.orientations).toEqual([
      { rotation: 'north', mirrored: false },
      { rotation: 'east', mirrored: false },
      { rotation: 'south', mirrored: false },
      { rotation: 'west', mirrored: false },
      { rotation: 'north', mirrored: true },
      { rotation: 'east', mirrored: true },
      { rotation: 'south', mirrored: true },
      { rotation: 'west', mirrored: true },
    ]);
    expect(machine.inputs.fluids).toEqual([
      {
        resource: 'fluid:1',
        positions: [{ position: { x: 0, y: -1 }, direction: 'north' }],
      },
    ]);
    expect(machine.outputs.fluids).toEqual([
      {
        resource: 'fluid:2',
        positions: [{ position: { x: 0, y: 1 }, direction: 'south' }],
      },
    ]);
  });

  it('retains gross machine transfers and reconciles an internal resource', () => {
    const problem = assemblerProblem({ solidInputs: [5], solidOutputs: [5] });
    problem.inputs.solids = { ore: 5 };
    problem.outputs.solids = { plate: 5 };
    problem.assemblers = [
      {
        id: 'smelter',
        name: 'Same operation',
        inputPerSecond: { ore: 5 },
        outputPerSecond: { intermediate: 5 },
      },
      {
        id: 'finisher',
        name: 'Same operation',
        inputPerSecond: { intermediate: 5 },
        outputPerSecond: { plate: 5 },
      },
    ];

    const input = normalized(problem, { repeatCount: 3, moduleHeight: 30 });
    expect(input.machines.map(({ id }) => id)).toEqual(['smelter', 'finisher']);
    expect(input.machines[0]?.outputs).toEqual({
      items: [{ resource: 'intermediate', rate: 5 }],
      fluids: [],
    });
    expect(input.machines[1]?.inputs).toEqual({
      items: [{ resource: 'intermediate', rate: 5 }],
      fluids: [],
    });
    expect(input.repeat).toEqual({ count: 3, moduleHeight: 30 });
    expect(input.transport.fluidThroughput).toBe('unlimited');
  });

  it('keeps both sides of a catalyst transfer', () => {
    const problem = assemblerProblem({});
    problem.inputs.solids = { catalyst: 2, feed: 3 };
    problem.outputs.solids = { catalyst: 2, product: 3 };
    problem.assemblers[0]!.inputPerSecond = { catalyst: 2, feed: 3 };
    problem.assemblers[0]!.outputPerSecond = { catalyst: 2, product: 3 };

    const input = normalized(problem);
    expect(input.machines[0]?.inputs.items).toContainEqual({
      resource: 'catalyst',
      rate: 2,
    });
    expect(input.machines[0]?.outputs.items).toContainEqual({
      resource: 'catalyst',
      rate: 2,
    });
    expect(input.repeat).toEqual({ count: 1 });
  });

  it('names a fluid at its required position without exposing source geometry', () => {
    const problem = assemblerProblem({ fluidInputs: [200], solidOutputs: [2] });
    problem.inputs.fluids = { 'fluid:1': 200 };
    problem.assemblers[0]!.inputPerSecond = { 'fluid:1': 200 };

    const machine = normalized(problem).machines[0]!;
    expect(machine.orientations).toContainEqual({ rotation: 'north', mirrored: true });
    expect(machine.inputs.fluids).toEqual([
      {
        resource: 'fluid:1',
        positions: [{ position: { x: 0, y: -1 }, direction: 'north' }],
      },
    ]);
    expect(machine.inputs.items).toEqual([]);
    expect(normalized(problem).boundary.inputs.fluids).toEqual(['fluid:1']);
  });

  it('keeps separate connections when one fluid needs several positions', () => {
    const problem = assemblerProblem({ fluidInputs: [200] });
    problem.assemblers[0]!.fluidBoxes = [
      {
        productionType: 'input',
        connections: [{ position: { x: -1, y: 0 }, direction: 'west', flowDirection: 'input' }],
      },
      {
        productionType: 'input',
        connections: [{ position: { x: 1, y: 0 }, direction: 'east', flowDirection: 'input' }],
      },
    ];

    expect(normalized(problem).machines[0]?.inputs.fluids).toEqual([
      {
        resource: 'fluid:1',
        positions: [{ position: { x: -1, y: 0 }, direction: 'west' }],
      },
      {
        resource: 'fluid:1',
        positions: [{ position: { x: 1, y: 0 }, direction: 'east' }],
      },
    ]);
  });

  it('uses explicit output assignments and retains alternate positions', () => {
    const problem = assemblerProblem({ fluidOutputs: [2, 3] });
    problem.outputs.fluids = { 'fluid:alpha': 2, 'fluid:beta': 3 };
    problem.assemblers[0]!.outputPerSecond = { 'fluid:alpha': 2, 'fluid:beta': 3 };
    problem.assemblers[0]!.fluidProducts = [
      { resource: 'fluid:beta', fluidboxIndex: 1 },
      { resource: 'fluid:alpha', fluidboxIndex: 2 },
    ];
    problem.assemblers[0]!.fluidBoxes = [
      {
        productionType: 'output',
        connections: [
          { position: { x: -1, y: 1 }, direction: 'south', flowDirection: 'output' },
          { position: { x: 1, y: 1 }, direction: 'south', flowDirection: 'output' },
        ],
      },
      {
        productionType: 'output',
        connections: [{ position: { x: 0, y: -1 }, direction: 'north', flowDirection: 'output' }],
      },
    ];

    const machine = normalized(problem).machines[0]!;
    expect(machine.orientations).toContainEqual({ rotation: 'north', mirrored: true });
    expect(machine.outputs.fluids).toEqual([
      {
        resource: 'fluid:beta',
        positions: [
          { position: { x: -1, y: 1 }, direction: 'south' },
          { position: { x: 1, y: 1 }, direction: 'south' },
        ],
      },
      {
        resource: 'fluid:alpha',
        positions: [{ position: { x: 0, y: -1 }, direction: 'north' }],
      },
    ]);
  });

  it('reports an unbalanced internal flow before search', () => {
    const problem = assemblerProblem({ solidInputs: [5], solidOutputs: [2] });
    problem.assemblers[0]!.outputPerSecond = { 'item 2': 2, stray: 1 };
    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      success: false,
      code: 'unbalanced-flow',
      resource: 'stray',
      message: expect.stringContaining('external supply'),
    });
  });

  it('validates fluid quantity consistency without exposing fluid rates', () => {
    const problem = assemblerProblem({ fluidInputs: [200] });
    problem.assemblers[0]!.inputPerSecond['fluid:1'] = 199;

    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      success: false,
      code: 'unbalanced-flow',
      resource: 'fluid:1',
    });
  });

  it('reports missing fluid positions, invalid rates, and duplicate machine IDs', () => {
    const missing = assemblerProblem({ fluidInputs: [1] });
    missing.assemblers[0]!.fluidBoxes = [];
    expect(normalizeTileDesignInput(missing, options)).toMatchObject({
      success: false,
      code: 'invalid-fluid',
      resource: 'fluid:1',
    });

    const badRate = assemblerProblem({ solidInputs: [1] });
    badRate.inputs.solids['item 1'] = Number.NaN;
    expect(normalizeTileDesignInput(badRate, options)).toMatchObject({
      success: false,
      code: 'invalid-rate',
      resource: 'item 1',
    });

    const duplicate = assemblerProblem({});
    duplicate.assemblers = [
      { id: 'same', name: 'a', inputPerSecond: {}, outputPerSecond: {} },
      { id: 'same', name: 'b', inputPerSecond: {}, outputPerSecond: {} },
    ];
    expect(normalizeTileDesignInput(duplicate, options)).toMatchObject({
      success: false,
      code: 'invalid-machine',
      message: expect.stringContaining('repeated'),
    });
  });

  it('rejects a fluid ID declared in the item boundary', () => {
    const problem = assemblerProblem({ fluidInputs: [1] });
    problem.inputs.solids['fluid:1'] = 1;

    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      success: false,
      code: 'invalid-resource',
      resource: 'fluid:1',
    });
  });

  it('rejects missing output assignments and invalid repeat rules', () => {
    const problem = assemblerProblem({ fluidOutputs: [1, 1] });
    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      success: false,
      code: 'invalid-fluid',
      message: expect.stringContaining('explicit output assignment'),
    });
    problem.assemblers[0]!.fluidProducts = [{ resource: 'fluid:missing' }];
    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      success: false,
      code: 'invalid-fluid',
    });
    expect(
      normalizeTileDesignInput(assemblerProblem({}), { ...options, repeatCount: 0 }),
    ).toMatchObject({
      success: false,
      code: 'invalid-rule',
    });
  });
});
