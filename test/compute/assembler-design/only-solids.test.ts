import { describe, expect, it } from 'vitest';
import { generateAssemblerDesign } from '../../../src/compute/assembler-design.ts';
import {
  beltStackLimit,
  physicalStackLimit,
} from '../../../src/components/design/design-stack-limit.ts';
import { entityPositionStatuses } from '../../../src/components/design/design-entities.tsx';
import { designBounds } from '../../../src/components/design/design-preview.tsx';
import { assemblerProblem } from '../../../src/compute/kernel-problems.ts';

const throughput = {
  beltItemsPerSecond: 30,
  inserterItemsPerSecond: 8,
  longInserterItemsPerSecond: 4,
};

describe('generateAssemblerDesign', () => {
  it('supports a 2×2 machine with one solid input and output', () => {
    const problem = assemblerProblem({
      size: { width: 2, height: 2 },
      solidInputs: [1],
      solidOutputs: [1],
    });
    const design = generateAssemblerDesign(problem, throughput);
    const column = design.columns?.[0];
    expect(column).toBeDefined();
    expect(entityPositionStatuses(column!.entities)).toEqual(column!.entities.map(() => 'valid'));
    expect(
      beltStackLimit(
        column!,
        {
          [problem.assemblers[0].name]: {
            ingredients: [{ resource: 'item:1' }],
            products: [{ resource: 'item:2' }],
          },
        },
        problem,
        throughput.beltItemsPerSecond,
      ),
    ).toBeGreaterThan(0);
  });

  it('supports two solid inputs and outputs on a 2×2 machine', () => {
    const problem = assemblerProblem({
      size: { width: 2, height: 2 },
      solidInputs: [1, 1],
      solidOutputs: [1, 1],
    });
    const design = generateAssemblerDesign(problem, throughput);
    const column = design.columns?.[0];
    expect(column).toBeDefined();
    expect(column!.entities.filter((entity) => entity.kind === 'belt')).toHaveLength(6);
    expect(
      column!.entities.filter((entity) => entity.kind === 'inserter' && entity.position.x === 4),
    ).toEqual([
      {
        kind: 'inserter',
        position: { x: 4, y: 1 },
        direction: 'east',
        filter: 'item:3',
      },
      {
        kind: 'inserter',
        position: { x: 4, y: 0 },
        direction: 'east',
        reach: 2,
        filter: 'item:4',
      },
    ]);
    expect(entityPositionStatuses(column!.entities)).toEqual(column!.entities.map(() => 'valid'));
    expect(
      beltStackLimit(
        column!,
        {
          [problem.assemblers[0].name]: {
            ingredients: [{ resource: 'item:1' }, { resource: 'item:2' }],
            products: [{ resource: 'item:3' }, { resource: 'item:4' }],
          },
        },
        problem,
        throughput.beltItemsPerSecond,
      ),
    ).toBeGreaterThan(0);
  });

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

  it('uses both full-height input sides for a high-rate solid on a 5×5 machine', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ size: { width: 5, height: 5 }, solidInputs: [70], solidOutputs: [2] }),
      { beltItemsPerSecond: 45, inserterItemsPerSecond: 8, longInserterItemsPerSecond: 4 },
    );
    const entities = design.columns?.[0].entities ?? [];
    expect(
      entities.filter(
        (entity) =>
          entity.kind === 'inserter' && entity.direction === 'east' && entity.position.x === 2,
      ),
    ).toHaveLength(5);
    expect(
      entities.filter(
        (entity) =>
          entity.kind === 'inserter' && entity.direction === 'west' && entity.position.x === 8,
      ),
    ).toHaveLength(4);
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

  it('keeps an input over half a belt off a mixed belt', () => {
    const design = generateAssemblerDesign(
      assemblerProblem({ solidInputs: [30, 5], solidOutputs: [3] }),
      { beltItemsPerSecond: 45, inserterItemsPerSecond: 16, longInserterItemsPerSecond: 8 },
    );
    const entities = design.columns?.[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'belt')).toHaveLength(9);
    expect(
      entities
        .filter((entity) => entity.kind === 'inserter' && entity.direction !== 'east')
        .map((entity) => entity.position.x),
    ).toContain(6);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
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
        'item:2',
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

  it.each([
    [
      { width: 5, height: 3 },
      { width: 5, height: 3 },
    ],
    [
      { width: 3, height: 5 },
      { width: 3, height: 5 },
    ],
  ] as const)('places solid output transport beyond a %j machine', (size, _unused) => {
    const design = generateAssemblerDesign(
      assemblerProblem({ size, solidInputs: [5], solidOutputs: [2] }),
      throughput,
    );
    const entities = design.columns?.[0].entities ?? [];
    expect(entities).toContainEqual({
      kind: 'inserter',
      position: { x: size.width + 2, y: Math.floor(size.height / 2) },
      direction: 'east',
    });
    expect(
      entities.filter((entity) => entity.kind === 'belt' && entity.position.x === size.width + 3),
    ).toHaveLength(size.height);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });
});
