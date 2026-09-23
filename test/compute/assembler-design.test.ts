import { describe, expect, it } from 'vitest';
import { generateAssemblerDesign } from '../../src/compute/assembler-design.ts';
import { physicalStackLimit } from '../../src/components/design/design-stack-limit.ts';
import { entityPositionStatuses } from '../../src/components/design/design-entities.tsx';
import { designBounds } from '../../src/components/design/design-preview.tsx';
import { airFilterProblem, assemblerProblem } from '../../src/compute/kernel-problems.ts';

const throughput = {
  beltItemsPerSecond: 30,
  inserterItemsPerSecond: 8,
  longInserterItemsPerSecond: 4,
};

describe('generateAssemblerDesign', () => {
  it('limits five-tile kernels to the physical height of the brick', () => {
    expect(
      physicalStackLimit({
        entities: [
          {
            kind: 'assembler',
            position: { x: 0, y: 0 },
            size: { width: 7, height: 5 },
            recipe: 'test',
          },
        ],
      }),
    ).toBe(20);
  });

  it('uses one input inserter for a low-rate solid input', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [5], solidOutputs: [2] }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 1, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'belt')).toEqual([
      { kind: 'belt', position: { x: 0, y: 0 }, direction: 'north' },
      { kind: 'belt', position: { x: 0, y: 1 }, direction: 'north' },
      { kind: 'belt', position: { x: 0, y: 2 }, direction: 'north' },
      { kind: 'belt', position: { x: 6, y: 0 }, direction: 'south' },
      { kind: 'belt', position: { x: 6, y: 1 }, direction: 'south' },
      { kind: 'belt', position: { x: 6, y: 2 }, direction: 'south' },
    ]);
    expect(entities).not.toContainEqual(expect.objectContaining({ kind: 'inserter', reach: 2 }));
    expect(designBounds(entities)).toEqual({ minX: 0, maxX: 7, minY: 0, maxY: 3 });
  });

  it('uses one input inserter when the input exactly matches its throughput', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [8], solidOutputs: [3] }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toHaveLength(2);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('adds a second inserter on the compact input belt when one cannot carry the rate', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [8], solidOutputs: [3] }),
      {
        beltItemsPerSecond: 30,
        inserterItemsPerSecond: 5.28,
        longInserterItemsPerSecond: 2.64,
      },
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 1, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'belt')).toHaveLength(6);
    expect(designBounds(entities)).toEqual({ minX: 0, maxX: 7, minY: 0, maxY: 3 });
  });

  it('uses all three assembler edge tiles when pulling 8/s with 3/s inserters', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [8], solidOutputs: [3] }),
      {
        beltItemsPerSecond: 15,
        inserterItemsPerSecond: 3,
        longInserterItemsPerSecond: 1.5,
      },
    );
    const inputInserters =
      design.columns?.[0].entities.filter(
        (entity) => entity.kind === 'inserter' && entity.position.x === 1,
      ) ?? [];

    expect(inputInserters).toEqual([
      { kind: 'inserter', position: { x: 1, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 1 }, direction: 'east' },
    ]);
  });

  it('adds a second short output inserter before rejecting a compact design', () => {
    const problem = assemblerProblem({ solidInputs: [5], solidOutputs: [10] });
    const design = generateAssemblerDesign(problem, {
      beltItemsPerSecond: 30,
      inserterItemsPerSecond: 5.28,
      longInserterItemsPerSecond: 2.64,
    });
    const outputInserters =
      design.columns?.[0].entities.filter(
        (entity) => entity.kind === 'inserter' && entity.position.x === 5,
      ) ?? [];

    expect(outputInserters).toEqual([
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 0 }, direction: 'east' },
    ]);
  });

  it('uses all three compact output sites when the output rate requires them', () => {
    const problem = assemblerProblem({ solidInputs: [5], solidOutputs: [15] });
    const design = generateAssemblerDesign(problem, {
      beltItemsPerSecond: 30,
      inserterItemsPerSecond: 5.28,
      longInserterItemsPerSecond: 2.64,
    });
    const outputInserters =
      design.columns?.[0].entities.filter(
        (entity) => entity.kind === 'inserter' && entity.position.x === 5,
      ) ?? [];

    expect(outputInserters).toEqual([
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 2 }, direction: 'east' },
    ]);
  });

  it('splits one high-rate input across two belts with five regular inserters', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [25], solidOutputs: [2] }),
      {
        beltItemsPerSecond: 30,
        inserterItemsPerSecond: 5.89,
        longInserterItemsPerSecond: 2.945,
      },
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'belt')).toHaveLength(9);
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 2, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 2, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 2, y: 1 }, direction: 'east' },
      { kind: 'inserter', position: { x: 6, y: 2 }, direction: 'west' },
      { kind: 'inserter', position: { x: 6, y: 0 }, direction: 'west' },
      { kind: 'inserter', position: { x: 6, y: 1 }, direction: 'east', reach: 2 },
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('packs three inputs onto two belts, with one mixed belt', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [5, 5, 8], solidOutputs: [2] }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'belt')).toHaveLength(9);
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 2, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 2, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 6, y: 2 }, direction: 'west' },
      { kind: 'inserter', position: { x: 6, y: 1 }, direction: 'east', reach: 2 },
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

  it('counts input belts by throughput before reporting the limiting inserter sites', () => {
    expect(
      generateAssemblerDesign(assemblerProblem({ solidInputs: [5, 5], solidOutputs: [2] }), {
        beltItemsPerSecond: 7.5,
        inserterItemsPerSecond: 3.15,
        longInserterItemsPerSecond: 1.575,
      }),
    ).toEqual({
      failure: [
        'cannot insert',
        'item 2',
        'into',
        'Assembler 1',
        'because',
        '2 inserters',
        'are needed but only',
        '1 tile',
        'is available beside the assembler',
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
});
