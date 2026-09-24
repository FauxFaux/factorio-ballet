import { describe, expect, it } from 'vitest';
import { assemblerProblem, type KernelProblem } from '../../../src/compute/kernel-problems.ts';
import {
  normalizeTileDesignInput,
  type TileDesignOptions,
} from '../../../src/compute/tile-design/problem.ts';

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
  expect(result.kind).toBe('valid');
  if (result.kind !== 'valid') throw new Error(result.message);
  return result.input;
}

describe('normalizeTileDesignInput', () => {
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
    expect(input.machines[0]?.outputs).toEqual([
      { resource: 'intermediate', kind: 'solid', rate: 5 },
    ]);
    expect(input.machines[1]?.inputs).toEqual([
      { resource: 'intermediate', kind: 'solid', rate: 5 },
    ]);
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
    expect(input.machines[0]?.inputs).toContainEqual({
      resource: 'catalyst',
      kind: 'solid',
      rate: 2,
    });
    expect(input.machines[0]?.outputs).toContainEqual({
      resource: 'catalyst',
      kind: 'solid',
      rate: 2,
    });
    expect(input.repeat).toEqual({ count: 1 });
  });

  it('names a fluid at its required position without exposing source geometry', () => {
    const problem = assemblerProblem({ fluidInputs: [200], solidOutputs: [2] });
    problem.inputs.fluids = { fluid1: 200 };
    problem.assemblers[0]!.inputPerSecond = { fluid1: 200 };

    expect(normalized(problem).machines[0]?.fluidRequirements).toEqual([
      {
        resource: 'fluid1',
        side: 'input',
        positions: [{ position: { x: 0, y: -1 }, direction: 'north' }],
      },
    ]);
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

    expect(normalized(problem).machines[0]?.fluidRequirements).toEqual([
      {
        resource: 'fluid 1',
        side: 'input',
        positions: [{ position: { x: -1, y: 0 }, direction: 'west' }],
      },
      {
        resource: 'fluid 1',
        side: 'input',
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

    expect(normalized(problem).machines[0]?.fluidRequirements).toEqual([
      {
        resource: 'fluid:beta',
        side: 'output',
        positions: [
          { position: { x: -1, y: 1 }, direction: 'south' },
          { position: { x: 1, y: 1 }, direction: 'south' },
        ],
      },
      {
        resource: 'fluid:alpha',
        side: 'output',
        positions: [{ position: { x: 0, y: -1 }, direction: 'north' }],
      },
    ]);
  });

  it('reports an unbalanced internal flow before search', () => {
    const problem = assemblerProblem({ solidInputs: [5], solidOutputs: [2] });
    problem.assemblers[0]!.outputPerSecond = { 'item 2': 2, stray: 1 };
    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      kind: 'invalid-input',
      code: 'unbalanced-flow',
      resource: 'stray',
      message: expect.stringContaining('external supply'),
    });
  });

  it('reports missing fluid positions, invalid rates, and duplicate machine IDs', () => {
    const missing = assemblerProblem({ fluidInputs: [1] });
    missing.assemblers[0]!.fluidBoxes = [];
    expect(normalizeTileDesignInput(missing, options)).toMatchObject({
      kind: 'invalid-input',
      code: 'invalid-fluid',
      resource: 'fluid 1',
    });

    const badRate = assemblerProblem({ solidInputs: [1] });
    badRate.inputs.solids['item 1'] = Number.NaN;
    expect(normalizeTileDesignInput(badRate, options)).toMatchObject({
      kind: 'invalid-input',
      code: 'invalid-rate',
      resource: 'item 1',
    });

    const duplicate = assemblerProblem({});
    duplicate.assemblers = [
      { id: 'same', name: 'a', inputPerSecond: {}, outputPerSecond: {} },
      { id: 'same', name: 'b', inputPerSecond: {}, outputPerSecond: {} },
    ];
    expect(normalizeTileDesignInput(duplicate, options)).toMatchObject({
      kind: 'invalid-input',
      code: 'invalid-machine',
      message: expect.stringContaining('repeated'),
    });
  });

  it('rejects missing output assignments and invalid repeat rules', () => {
    const problem = assemblerProblem({ fluidOutputs: [1, 1] });
    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      kind: 'invalid-input',
      code: 'invalid-fluid',
      message: expect.stringContaining('explicit output assignment'),
    });
    problem.assemblers[0]!.fluidProducts = [{ resource: 'fluid:missing' }];
    expect(normalizeTileDesignInput(problem, options)).toMatchObject({
      kind: 'invalid-input',
      code: 'invalid-fluid',
    });
    expect(
      normalizeTileDesignInput(assemblerProblem({}), { ...options, repeatCount: 0 }),
    ).toMatchObject({
      kind: 'invalid-input',
      code: 'invalid-rule',
    });
  });
});
