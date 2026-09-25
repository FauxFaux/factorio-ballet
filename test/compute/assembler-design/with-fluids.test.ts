import { describe, expect, it } from 'vitest';
import { generateAssemblerDesign } from '../../../src/compute/assembler-design.ts';
import { entityPositionStatuses } from '../../../src/components/design/design-entities.tsx';
import { designBounds } from '../../../src/components/design/design-preview.tsx';
import { beltStackLimit } from '../../../src/components/design/design-stack-limit.ts';
import { designFluidTraces } from '../../../src/components/design/design-fluid-traces.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../../../src/data/inserter-throughput.ts';
import cpuCell from '../../../docs/cells/cpu.json';
import {
  airFilterProblem,
  assemblerProblem,
  kernelProblems,
} from '../../../src/compute/kernel-problems.ts';
import { defaultDataset } from '../../with-bobang.ts';

const throughput = {
  beltItemsPerSecond: 30,
  inserterItemsPerSecond: 8,
  longInserterItemsPerSecond: 4,
};

describe('generateAssemblerDesign', () => {
  it.each([15, 30])('feeds molten silicon from the CPU cell using %s items/s belts', (beltRate) => {
    const row = cpuCell.recipes.find(({ recipe }) => recipe === 'angels-liquid-molten-silicon')!;
    const machine = defaultDataset.data.machines['angels-chemical-furnace-3'];
    const inputRate = row.inputs[0].rate / row.count;
    const outputRate = row.outputs[0].rate / row.count;
    const design = generateAssemblerDesign(
      assemblerProblem({
        assemblerName: row.recipe,
        size: machine.size,
        fluidBoxes: machine.fluidBoxes,
        solidInputs: [inputRate],
        fluidOutputs: [outputRate],
      }),
      {
        beltItemsPerSecond: beltRate,
        inserterItemsPerSecond: 8,
        longInserterItemsPerSecond: 4,
      },
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toHaveLength(
      beltRate === 15 ? 5 : 4,
    );
    expect(entities.filter((entity) => entity.kind === 'belt')).toHaveLength(
      beltRate === 15 ? 10 : 5,
    );
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('states the two-belt limit when molten silicon uses basic belts', () => {
    const row = cpuCell.recipes.find(({ recipe }) => recipe === 'angels-liquid-molten-silicon')!;
    const machine = defaultDataset.data.machines['angels-chemical-furnace-3'];
    const design = generateAssemblerDesign(
      assemblerProblem({
        assemblerName: row.recipe,
        size: machine.size,
        fluidBoxes: machine.fluidBoxes,
        solidInputs: [row.inputs[0].rate / row.count],
        fluidOutputs: [row.outputs[0].rate / row.count],
      }),
      { beltItemsPerSecond: 7.5, inserterItemsPerSecond: 8, longInserterItemsPerSecond: 4 },
    );

    expect(design).toEqual({
      failure: [
        'cannot feed',
        'item:1',
        'at',
        '25.2 items/s',
        'because two',
        '7.5 items/s',
        'input belts and their available inserters can transfer at most',
        '15 items/s',
      ],
    });
  });

  it('stacks two molten-silicon furnaces on one 75 items/s input belt', () => {
    const row = cpuCell.recipes.find(({ recipe }) => recipe === 'angels-liquid-molten-silicon')!;
    const machine = defaultDataset.data.machines['angels-chemical-furnace-3'];
    const inputRate = row.inputs[0].rate / row.count;
    const problem = assemblerProblem({
      assemblerName: row.recipe,
      size: machine.size,
      fluidBoxes: machine.fluidBoxes,
      solidInputs: [inputRate],
      fluidOutputs: [row.outputs[0].rate / row.count],
    });
    problem.inputs.solids = { 'item:angels-ingot-silicon': inputRate };
    const design = generateAssemblerDesign(problem, {
      beltItemsPerSecond: 75,
      inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(
        defaultDataset.data,
        1,
        defaultDataset.data.belts['bob-ultimate-transport-belt'],
      ),
      longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(
        defaultDataset.data,
        1,
        defaultDataset.data.belts['bob-ultimate-transport-belt'],
        2,
      ),
    });
    const column = design.columns?.[0];
    expect(column).toBeDefined();
    expect(
      beltStackLimit(
        column!,
        {
          [row.recipe]: {
            ingredients: [{ resource: 'item:angels-ingot-silicon' }],
            products: [{ resource: 'fluid:angels-liquid-molten-silicon' }],
          },
        },
        problem,
        75,
      ),
    ).toBe(2);
  });

  it('keeps air separation input and both outputs on independent chemical-plant trunks', () => {
    const recipeName = 'angels-air-separation';
    const recipe = defaultDataset.data.recipes[recipeName];
    const machine = defaultDataset.data.machines['chemical-plant'];
    const design = generateAssemblerDesign(
      assemblerProblem({
        assemblerName: recipeName,
        size: machine.size,
        fluidBoxes: machine.fluidBoxes,
        fluidInputs: [100],
        fluidOutputs: [50, 50],
      }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];
    expect(
      entities.filter((entity) => entity.kind === 'pipe' || entity.kind === 'underground-pipe'),
    ).toHaveLength(12);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    expect(designBounds(entities)).toEqual({ minX: 0, maxX: 8, minY: 0, maxY: 3 });

    const traces = designFluidTraces(
      { entities },
      { [recipeName]: recipe },
      { [recipeName]: machine },
      true,
    );
    const trunkFluids = [0, 2, 7].map((x) => {
      const index = entities.findIndex(
        (entity) => entity.kind === 'pipe' && entity.position.x === x && entity.position.y === 0,
      );
      return traces.pipeTraces.get(index)?.fluids;
    });
    expect(trunkFluids[2]).toEqual(['fluid:angels-gas-compressed-air']);
    expect(trunkFluids[0]).toHaveLength(1);
    expect(trunkFluids[1]).toHaveLength(1);
    expect(new Set([...trunkFluids[0]!, ...trunkFluids[1]!])).toEqual(
      new Set(['fluid:angels-gas-nitrogen', 'fluid:angels-gas-oxygen']),
    );
    expect([...traces.assemblerStatuses.values()][0]?.missing).toEqual([]);
  });

  it('does not run the adjacent input trunk past an output port', () => {
    const machine = defaultDataset.data.machines['chemical-plant'];
    const fluidBoxes = machine.fluidBoxes!.map((box, index) =>
      index === 1
        ? {
            ...box,
            productionType: 'output' as const,
            connections: box.connections.map((connection) => ({
              ...connection,
              flowDirection: 'output' as const,
            })),
          }
        : box,
    );
    const design = generateAssemblerDesign(
      assemblerProblem({
        assemblerName: 'Plant with an east output',
        size: machine.size,
        fluidBoxes,
        fluidInputs: [100],
        fluidOutputs: [50, 50],
      }),
      throughput,
    );

    expect(design.columns).toBeUndefined();
  });

  it('connects the flare stack fluid input without adding an output belt', () => {
    const machine = defaultDataset.data.machines['angels-flare-stack'];
    const design = generateAssemblerDesign(
      assemblerProblem({
        assemblerName: 'angels-chemical-void-angels-gas-oxygen',
        size: machine.size,
        fluidBoxes: machine.fluidBoxes,
        fluidInputs: [400],
      }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities).toEqual([
      { kind: 'pipe', position: { x: 0, y: 0 } },
      { kind: 'pipe', position: { x: 0, y: 1 } },
      {
        kind: 'assembler',
        position: { x: 1, y: 0 },
        size: { width: 2, height: 2 },
        recipe: 'angels-chemical-void-angels-gas-oxygen',
        direction: 'east',
      },
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('connects a fluid output when the recipe consumes no resources', () => {
    const design = generateAssemblerDesign(
      kernelProblems(defaultDataset.data).fluidOutput[6]!,
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities).toEqual([
      ...Array.from({ length: 3 }, (_, y) => ({ kind: 'pipe', position: { x: 0, y } })),
      {
        kind: 'assembler',
        position: { x: 1, y: 0 },
        size: { width: 3, height: 3 },
        recipe: 'Assembler 2',
        direction: 'east',
      },
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it.each([
    [
      'fluid-only input',
      assemblerProblem({ fluidInputs: [200], solidOutputs: [2] }),
      [],
      [{ position: { x: 4, y: 1 }, direction: 'east' }],
    ],
    [
      'one solid and one fluid input',
      assemblerProblem({ solidInputs: [5], fluidInputs: [200], solidOutputs: [2] }),
      [{ position: { x: 4, y: 2 }, direction: 'west' }],
      [{ position: { x: 4, y: 1 }, direction: 'east', reach: 2 }],
    ],
    [
      'two solids and one fluid input',
      assemblerProblem({ solidInputs: [5, 8], fluidInputs: [200], solidOutputs: [2] }),
      [
        { position: { x: 4, y: 2 }, direction: 'west' },
        { position: { x: 4, y: 0 }, direction: 'west' },
      ],
      [{ position: { x: 4, y: 1 }, direction: 'east', reach: 2 }],
    ],
  ] as const)('reserves the left pipe trunk for %s', (_description, problem, inputs, outputs) => {
    const design = generateAssemblerDesign(problem, throughput);
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual([
      { kind: 'pipe', position: { x: 0, y: 0 } },
      { kind: 'pipe', position: { x: 0, y: 1 } },
      { kind: 'pipe', position: { x: 0, y: 2 } },
    ]);
    expect(entities).toContainEqual({
      kind: 'assembler',
      position: { x: 1, y: 0 },
      size: { width: 3, height: 3 },
      recipe: 'Assembler 2',
      direction: 'west',
    });
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      ...inputs.map((inserter) => ({ kind: 'inserter', ...inserter })),
      ...outputs.map((inserter) => ({ kind: 'inserter', ...inserter })),
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it.each([
    ['one low-rate solid input', assemblerProblem({ solidInputs: [5], fluidOutputs: [200] }), 1],
    ['one medium-rate solid input', assemblerProblem({ solidInputs: [8], fluidOutputs: [200] }), 1],
    ['one high-rate solid input', assemblerProblem({ solidInputs: [25], fluidOutputs: [200] }), 3],
    ['two solid inputs', assemblerProblem({ solidInputs: [5, 5], fluidOutputs: [200] }), 1],
  ] as const)(
    'uses the left pipe trunk and right input belt for %s',
    (_description, problem, inserterCount) => {
      const design = generateAssemblerDesign(problem, {
        beltItemsPerSecond: 30,
        inserterItemsPerSecond: 12,
        longInserterItemsPerSecond: 6,
      });
      const entities = design.columns?.[0].entities ?? [];

      expect(entities.filter((entity) => entity.kind === 'pipe')).toHaveLength(3);
      expect(entities.filter((entity) => entity.kind === 'belt')).toEqual([
        { kind: 'belt', position: { x: 5, y: 0 }, direction: 'north' },
        { kind: 'belt', position: { x: 5, y: 1 }, direction: 'north' },
        { kind: 'belt', position: { x: 5, y: 2 }, direction: 'north' },
      ]);
      expect(entities.filter((entity) => entity.kind === 'inserter')).toHaveLength(inserterCount);
      expect(entities).toContainEqual({
        kind: 'assembler',
        position: { x: 1, y: 0 },
        size: { width: 3, height: 3 },
        recipe: 'Assembler 2',
        direction: 'east',
      });
      expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    },
  );

  it('adds a far right input belt for five solid inputs and a fluid output', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [5, 5, 8], fluidOutputs: [200] }),
      {
        beltItemsPerSecond: 30,
        inserterItemsPerSecond: 12,
        longInserterItemsPerSecond: 6,
      },
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'belt')).toEqual([
      { kind: 'belt', position: { x: 5, y: 0 }, direction: 'north' },
      { kind: 'belt', position: { x: 5, y: 1 }, direction: 'north' },
      { kind: 'belt', position: { x: 5, y: 2 }, direction: 'north' },
      { kind: 'belt', position: { x: 6, y: 0 }, direction: 'north' },
      { kind: 'belt', position: { x: 6, y: 1 }, direction: 'north' },
      { kind: 'belt', position: { x: 6, y: 2 }, direction: 'north' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 4, y: 2 }, direction: 'west' },
      { kind: 'inserter', position: { x: 4, y: 1 }, direction: 'west', reach: 2 },
      { kind: 'inserter', position: { x: 4, y: 0 }, direction: 'west', reach: 2 },
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it.each([
    ['input', { fluidInputs: [200] }, 'east'],
    ['output', { fluidOutputs: [200] }, 'west'],
  ] as const)(
    'routes a fluid %s outside three solid inputs and one solid output',
    (_flow, fluidOptions, direction) => {
      const design = generateAssemblerDesign(
        assemblerProblem({
          solidInputs: [5, 5, 8],
          solidOutputs: [2],
          ...fluidOptions,
        }),
        throughput,
      );
      const entities = design.columns?.[0].entities ?? [];

      expect(entities).toContainEqual({
        kind: 'assembler',
        position: { x: 3, y: 0 },
        size: { width: 3, height: 3 },
        recipe: 'Assembler 2',
        direction,
      });
      expect(entities.filter((entity) => entity.kind === 'underground-pipe')).toEqual([
        { kind: 'underground-pipe', position: { x: 6, y: 1 }, direction: 'west' },
        { kind: 'underground-pipe', position: { x: 8, y: 1 }, direction: 'east' },
      ]);
      expect(entities.filter((entity) => entity.kind === 'underground-belt')).toEqual([
        {
          kind: 'underground-belt',
          position: { x: 8, y: 0 },
          direction: 'south',
          end: 'input',
        },
        {
          kind: 'underground-belt',
          position: { x: 8, y: 2 },
          direction: 'south',
          end: 'output',
        },
      ]);
      expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual(
        Array.from({ length: 3 }, (_, y) => ({
          kind: 'pipe' as const,
          position: { x: 9, y },
        })),
      );
      expect(entities).toContainEqual({
        kind: 'inserter',
        position: { x: 6, y: 0 },
        direction: 'east',
        reach: 2,
      });
      expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    },
  );

  it('uses separate outside trunks when three solid inputs and one solid output use both fluids', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({
        solidInputs: [5, 5, 8],
        fluidInputs: [200],
        solidOutputs: [2],
        fluidOutputs: [200],
      }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'underground-pipe')).toEqual([
      { kind: 'underground-pipe', position: { x: 6, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 8, y: 1 }, direction: 'east' },
      { kind: 'underground-pipe', position: { x: 2, y: 1 }, direction: 'east' },
      { kind: 'underground-pipe', position: { x: 0, y: 1 }, direction: 'west' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual([
      ...Array.from({ length: 3 }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: 9, y },
      })),
      ...Array.from({ length: 3 }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: -1, y },
      })),
    ]);
    expect(entities).toContainEqual({
      kind: 'assembler',
      position: { x: 3, y: 0 },
      size: { width: 3, height: 3 },
      recipe: 'Assembler 2',
      direction: 'west',
    });
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('explains unsupported outputs and missing fluid-port geometry', () => {
    expect(
      generateAssemblerDesign(
        assemblerProblem({ solidInputs: [5, 5, 5], solidOutputs: [2, 2] }),
        throughput,
      ),
    ).toEqual({
      failure: [
        'cannot extract from',
        'Assembler 1',
        'because this generator supports exactly one solid output, not',
        '2',
      ],
    });
    expect(
      generateAssemblerDesign(
        assemblerProblem({
          assemblerName: 'No fluid ports',
          fluidInputs: [200],
          fluidOutputs: [200],
        }),
        throughput,
      ),
    ).toEqual({
      failure: [
        'cannot connect fluids to',
        'No fluid ports',
        'because its size or fluid-port geometry is missing',
      ],
    });
  });

  it('explains when an input needs more inserters than the assembler side can fit', () => {
    const problem = assemblerProblem({ solidInputs: [21], fluidOutputs: [200] });
    problem.inputs.solids = { 'item:item1': 21 };

    expect(
      generateAssemblerDesign(problem, {
        beltItemsPerSecond: 30,
        inserterItemsPerSecond: 3,
        longInserterItemsPerSecond: 1.5,
      }),
    ).toEqual({
      failure: [
        'cannot insert',
        'item:item1',
        'into',
        'Assembler 2',
        'because',
        '7 inserters',
        'are needed but only',
        '3 tiles',
        'are available beside the assembler',
      ],
    });
  });

  it('rotates Assembler 2 so its north input and south output meet opposite pipe trunks', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ fluidInputs: [200], fluidOutputs: [200] }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'assembler')).toEqual([
      {
        kind: 'assembler',
        position: { x: 1, y: 0 },
        size: { width: 3, height: 3 },
        recipe: 'Assembler 2',
        direction: 'west',
      },
    ]);
    expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual([
      ...Array.from({ length: 3 }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: 0, y },
      })),
      ...Array.from({ length: 3 }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: 4, y },
      })),
    ]);
  });

  it.each([5, 12])('feeds a %s/s solid input between separate fluid trunks', (inputRate) => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [inputRate], fluidInputs: [200], fluidOutputs: [200] }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities).toContainEqual({
      kind: 'assembler',
      position: { x: 1, y: 0 },
      size: { width: 3, height: 3 },
      recipe: 'Assembler 2',
      direction: 'west',
    });
    expect(entities.filter((entity) => entity.kind === 'belt')).toEqual([]);
    expect(entities.filter((entity) => entity.kind === 'underground-belt')).toEqual([
      { kind: 'underground-belt', position: { x: 5, y: 2 }, direction: 'north', end: 'input' },
      { kind: 'underground-belt', position: { x: 5, y: 0 }, direction: 'north', end: 'output' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual(
      [2, 0].slice(0, Math.ceil(inputRate / throughput.inserterItemsPerSecond)).map((y) => ({
        kind: 'inserter' as const,
        position: { x: 4, y },
        direction: 'west' as const,
      })),
    );
    expect(entities.filter((entity) => entity.kind === 'underground-pipe')).toEqual([
      { kind: 'underground-pipe', position: { x: 4, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 5, y: 1 }, direction: 'east' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual([
      ...Array.from({ length: 3 }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: 0, y },
      })),
      ...Array.from({ length: 3 }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: 6, y },
      })),
    ]);
    expect(designBounds(entities)).toEqual({ minX: 0, maxX: 7, minY: 0, maxY: 3 });
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it.each([
    [5, 8],
    [12, 12],
  ])('feeds two solid inputs at %s/s and %s/s across both fluid trunks', (leftRate, rightRate) => {
    const design = generateAssemblerDesign(
      assemblerProblem({
        solidInputs: [leftRate, rightRate],
        fluidInputs: [200],
        fluidOutputs: [200],
      }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'assembler')).toEqual([
      {
        kind: 'assembler',
        position: { x: 3, y: 0 },
        size: { width: 3, height: 3 },
        recipe: 'Assembler 2',
        direction: 'west',
      },
    ]);
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      ...[2, 0].slice(0, Math.ceil(leftRate / throughput.inserterItemsPerSecond)).map((y) => ({
        kind: 'inserter' as const,
        position: { x: 2, y },
        direction: 'east' as const,
      })),
      ...[2, 0].slice(0, Math.ceil(rightRate / throughput.inserterItemsPerSecond)).map((y) => ({
        kind: 'inserter' as const,
        position: { x: 6, y },
        direction: 'west' as const,
      })),
    ]);
    expect(entities.filter((entity) => entity.kind === 'underground-belt')).toEqual(
      [1, 7].flatMap((x) => [
        {
          kind: 'underground-belt' as const,
          position: { x, y: 2 },
          direction: 'north' as const,
          end: 'input' as const,
        },
        {
          kind: 'underground-belt' as const,
          position: { x, y: 0 },
          direction: 'north' as const,
          end: 'output' as const,
        },
      ]),
    );
    expect(entities.filter((entity) => entity.kind === 'underground-pipe')).toEqual([
      { kind: 'underground-pipe', position: { x: 1, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 2, y: 1 }, direction: 'east' },
      { kind: 'underground-pipe', position: { x: 6, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 7, y: 1 }, direction: 'east' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual(
      [0, 8].flatMap((x) =>
        Array.from({ length: 3 }, (_, y) => ({ kind: 'pipe' as const, position: { x, y } })),
      ),
    );
    expect(designBounds(entities)).toEqual({ minX: 0, maxX: 9, minY: 0, maxY: 3 });
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('routes two solid inputs and a solid output between opposing fluid trunks', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({
        solidInputs: [3, 5],
        fluidInputs: [200],
        solidOutputs: [12],
        fluidOutputs: [200],
      }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities).toContainEqual({
      kind: 'assembler',
      position: { x: 4, y: 0 },
      size: { width: 3, height: 3 },
      recipe: 'Assembler 2',
      direction: 'west',
    });
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 3, y: 0 }, direction: 'east', reach: 2 },
      { kind: 'inserter', position: { x: 3, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 7, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 7, y: 2 }, direction: 'east' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'underground-belt')).toEqual([
      { kind: 'underground-belt', position: { x: 1, y: 2 }, direction: 'north', end: 'input' },
      { kind: 'underground-belt', position: { x: 1, y: 0 }, direction: 'north', end: 'output' },
      { kind: 'underground-belt', position: { x: 8, y: 0 }, direction: 'south', end: 'input' },
      { kind: 'underground-belt', position: { x: 8, y: 2 }, direction: 'south', end: 'output' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'underground-pipe')).toEqual([
      { kind: 'underground-pipe', position: { x: 1, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 3, y: 1 }, direction: 'east' },
      { kind: 'underground-pipe', position: { x: 7, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 8, y: 1 }, direction: 'east' },
    ]);
    expect(
      entities.filter((entity) => entity.kind === 'pipe').map(({ position }) => position),
    ).toEqual([0, 9].flatMap((x) => [0, 1, 2].map((y) => ({ x, y }))));
    expect(designBounds(entities)).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 3 });
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('shares the near input belt when neither solid fits a long inserter', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({
        solidInputs: [5, 5],
        fluidInputs: [200],
        solidOutputs: [2],
        fluidOutputs: [200],
      }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(
      entities.filter((entity) => entity.kind === 'inserter' && entity.position.x === 3),
    ).toEqual([
      { kind: 'inserter', position: { x: 3, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 3, y: 2 }, direction: 'east' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'underground-belt')).toHaveLength(2);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('rejects a shared input belt when one solid exceeds a lane', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({
        solidInputs: [24, 5],
        fluidInputs: [200],
        solidOutputs: [3],
        fluidOutputs: [200],
      }),
      { beltItemsPerSecond: 45, inserterItemsPerSecond: 16, longInserterItemsPerSecond: 4 },
    );

    expect(design).toEqual({
      failure: ['cannot feed both solid inputs through the available belts and inserter sites'],
    });
  });

  it.each([
    [
      { width: 3, height: 5 },
      { width: 5, height: 3 },
    ],
    [
      { width: 5, height: 3 },
      { width: 3, height: 5 },
    ],
    [
      { width: 5, height: 5 },
      { width: 5, height: 5 },
    ],
  ] as const)('rotates a %j air filter between separate fluid trunks', (prototypeSize, size) => {
    const design = generateAssemblerDesign(airFilterProblem(prototypeSize), throughput);
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'assembler')).toEqual([
      {
        kind: 'assembler',
        position: { x: 1, y: 0 },
        size,
        recipe: `Air filter ${prototypeSize.width}×${prototypeSize.height}`,
        direction: 'east',
      },
    ]);
    expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual([
      ...Array.from({ length: size.height }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: 0, y },
      })),
      ...Array.from({ length: size.height }, (_, y) => ({
        kind: 'pipe' as const,
        position: { x: size.width + 1, y },
      })),
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    expect(designBounds(entities)).toEqual({
      minX: 0,
      maxX: size.width + 2,
      minY: 0,
      maxY: size.height,
    });
  });

  it.each([
    [
      { width: 3, height: 5 },
      { width: 5, height: 3 },
    ],
    [
      { width: 5, height: 3 },
      { width: 3, height: 5 },
    ],
    [
      { width: 5, height: 5 },
      { width: 5, height: 5 },
    ],
  ] as const)(
    'feeds a solid beside opposing fluid trunks on a rotated %j air filter',
    (size, rotated) => {
      const problem = airFilterProblem(size);
      problem.inputs.solids = { 'item:test': 5 };
      const design = generateAssemblerDesign(problem, throughput);
      const entities = design.columns?.[0].entities ?? [];
      expect(entities).toContainEqual({
        kind: 'assembler',
        position: { x: 1, y: 0 },
        size: rotated,
        recipe: `Air filter ${size.width}×${size.height}`,
        direction: 'east',
      });
      expect(entities).toContainEqual({
        kind: 'inserter',
        position: { x: rotated.width + 1, y: rotated.height - 1 },
        direction: 'west',
      });
      expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    },
  );

  it('uses all four free side tiles to feed a 5×5 air filter', () => {
    const problem = airFilterProblem({ width: 5, height: 5 });
    problem.inputs.solids = { 'item:test': 32 };
    const design = generateAssemblerDesign(problem, {
      ...throughput,
      beltItemsPerSecond: 45,
    });
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual(
      [4, 0, 1, 3].map((y) => ({
        kind: 'inserter',
        position: { x: 6, y },
        direction: 'west',
      })),
    );
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('splits one high-rate solid across both sides of a 5×5 air filter', () => {
    const problem = airFilterProblem({ width: 5, height: 5 });
    problem.inputs.solids = { 'item:test': 60 };
    const design = generateAssemblerDesign(problem, {
      ...throughput,
      beltItemsPerSecond: 45,
    });
    const entities = design.columns?.[0].entities ?? [];
    expect(
      entities.filter((entity) => entity.kind === 'inserter' && entity.position.x === 2),
    ).toHaveLength(4);
    expect(
      entities.filter((entity) => entity.kind === 'inserter' && entity.position.x === 8),
    ).toHaveLength(4);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('reports four available inserter tiles on a 5×5 air filter', () => {
    const problem = airFilterProblem({ width: 5, height: 5 });
    problem.inputs.solids = { 'item:test': 72 };

    expect(generateAssemblerDesign(problem, { ...throughput, beltItemsPerSecond: 45 })).toEqual({
      failure: [
        'cannot insert',
        'item:test',
        'into',
        'Air filter 5×5',
        'because',
        '5 inserters',
        'are needed but only',
        '4 tiles',
        'are available beside the assembler',
      ],
    });
  });

  it.each(['input', 'output'] as const)(
    'places right-side transport after rotating a rectangular machine with a fluid %s',
    (fluidSide) => {
      const problem = assemblerProblem({
        size: { width: 3, height: 5 },
        solidInputs: [5],
        ...(fluidSide === 'input'
          ? { fluidInputs: [200], solidOutputs: [2] }
          : { fluidOutputs: [200] }),
      });
      const design = generateAssemblerDesign(problem, throughput);
      const entities = design.columns?.[0].entities ?? [];
      const machine = entities.find((entity) => entity.kind === 'assembler');
      expect(machine?.size).toEqual({ width: 5, height: 3 });
      expect(
        entities
          .filter((entity) => entity.kind === 'inserter')
          .every((entity) => entity.position.x === 6),
      ).toBe(true);
      expect(
        entities.filter((entity) => entity.kind === 'belt' && entity.position.x === 7),
      ).toHaveLength(3);
      expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    },
  );
});
