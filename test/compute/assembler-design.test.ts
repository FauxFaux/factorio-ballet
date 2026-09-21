import { describe, expect, it } from 'vitest';
import { generateAssemblerDesign } from '../../src/compute/assembler-design.ts';
import { entityPositionStatuses } from '../../src/components/design/design-entities.tsx';
import { designBounds } from '../../src/components/design/design-preview.tsx';
import { kernelProblems } from '../../src/compute/kernel-problems.ts';

const throughput = {
  beltItemsPerSecond: 30,
  inserterItemsPerSecond: 8,
  longInserterItemsPerSecond: 4,
};

describe('generateAssemblerDesign', () => {
  it('uses one input inserter for Problem 1', () => {
    const design = generateAssemblerDesign(kernelProblems[0]!, throughput);
    const entities = design?.columns[0].entities ?? [];

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

  it('uses one input inserter for Problem 2 when it exactly matches throughput', () => {
    const design = generateAssemblerDesign(kernelProblems[1]!, throughput);
    const entities = design?.columns[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toHaveLength(2);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('adds a second inserter on the compact input belt when one cannot carry the rate', () => {
    const design = generateAssemblerDesign(kernelProblems[1]!, {
      beltItemsPerSecond: 30,
      inserterItemsPerSecond: 5.28,
      longInserterItemsPerSecond: 2.64,
    });
    const entities = design?.columns[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 1, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
    ]);
    expect(entities.filter((entity) => entity.kind === 'belt')).toHaveLength(6);
    expect(designBounds(entities)).toEqual({ minX: 0, maxX: 7, minY: 0, maxY: 3 });
  });

  it('uses all three assembler edge tiles when pulling 8/s with 3/s inserters', () => {
    const design = generateAssemblerDesign(kernelProblems[1]!, {
      beltItemsPerSecond: 15,
      inserterItemsPerSecond: 3,
      longInserterItemsPerSecond: 1.5,
    });
    const inputInserters =
      design?.columns[0].entities.filter(
        (entity) => entity.kind === 'inserter' && entity.position.x === 1,
      ) ?? [];

    expect(inputInserters).toEqual([
      { kind: 'inserter', position: { x: 1, y: 2 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 1 }, direction: 'east' },
    ]);
  });

  it('adds a second short output inserter before rejecting a compact design', () => {
    const problem = {
      ...kernelProblems[0]!,
      outputs: { solids: { 'item 2': 10 }, fluids: {} },
    };
    const design = generateAssemblerDesign(problem, {
      beltItemsPerSecond: 30,
      inserterItemsPerSecond: 5.28,
      longInserterItemsPerSecond: 2.64,
    });
    const outputInserters =
      design?.columns[0].entities.filter(
        (entity) => entity.kind === 'inserter' && entity.position.x === 5,
      ) ?? [];

    expect(outputInserters).toEqual([
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 0 }, direction: 'east' },
    ]);
  });

  it('uses all three compact output sites when the output rate requires them', () => {
    const problem = {
      ...kernelProblems[0]!,
      outputs: { solids: { 'item 2': 15 }, fluids: {} },
    };
    const design = generateAssemblerDesign(problem, {
      beltItemsPerSecond: 30,
      inserterItemsPerSecond: 5.28,
      longInserterItemsPerSecond: 2.64,
    });
    const outputInserters =
      design?.columns[0].entities.filter(
        (entity) => entity.kind === 'inserter' && entity.position.x === 5,
      ) ?? [];

    expect(outputInserters).toEqual([
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 2 }, direction: 'east' },
    ]);
  });

  it('splits Problem 3 across two belts with five regular inserters', () => {
    const design = generateAssemblerDesign(kernelProblems[2]!, {
      beltItemsPerSecond: 30,
      inserterItemsPerSecond: 5.89,
      longInserterItemsPerSecond: 2.945,
    });
    const entities = design?.columns[0].entities ?? [];

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
    const design = generateAssemblerDesign(kernelProblems[4]!, throughput);
    const entities = design?.columns[0].entities ?? [];

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
    [7, [], [{ position: { x: 4, y: 1 }, direction: 'east' }]],
    [
      8,
      [{ position: { x: 4, y: 2 }, direction: 'west' }],
      [{ position: { x: 4, y: 1 }, direction: 'east', reach: 2 }],
    ],
    [
      9,
      [
        { position: { x: 4, y: 2 }, direction: 'west' },
        { position: { x: 4, y: 0 }, direction: 'west' },
      ],
      [{ position: { x: 4, y: 1 }, direction: 'east', reach: 2 }],
    ],
  ] as const)('reserves the left pipe trunk for Problem %s', (problemNumber, inputs, outputs) => {
    const design = generateAssemblerDesign(kernelProblems[problemNumber - 1]!, throughput);
    const entities = design?.columns[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'pipe')).toEqual([
      { kind: 'pipe', position: { x: 0, y: 0 } },
      { kind: 'pipe', position: { x: 0, y: 1 } },
      { kind: 'pipe', position: { x: 0, y: 2 } },
    ]);
    expect(entities).toContainEqual({
      kind: 'assembler',
      position: { x: 1, y: 0 },
      size: { width: 3, height: 3 },
      recipe: 'Assembler 1',
    });
    expect(entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      ...inputs.map((inserter) => ({ kind: 'inserter', ...inserter })),
      ...outputs.map((inserter) => ({ kind: 'inserter', ...inserter })),
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it.each([
    [11, 1],
    [12, 1],
    [13, 3],
    [14, 1],
  ] as const)(
    'uses the left pipe trunk and right input belt for Problem %s',
    (problemNumber, inserterCount) => {
      const design = generateAssemblerDesign(kernelProblems[problemNumber - 1]!, {
        beltItemsPerSecond: 30,
        inserterItemsPerSecond: 12,
        longInserterItemsPerSecond: 6,
      });
      const entities = design?.columns[0].entities ?? [];

      expect(entities.filter((entity) => entity.kind === 'pipe')).toHaveLength(3);
      expect(entities.filter((entity) => entity.kind === 'belt')).toEqual([
        { kind: 'belt', position: { x: 5, y: 0 }, direction: 'north' },
        { kind: 'belt', position: { x: 5, y: 1 }, direction: 'north' },
        { kind: 'belt', position: { x: 5, y: 2 }, direction: 'north' },
      ]);
      expect(entities.filter((entity) => entity.kind === 'inserter')).toHaveLength(inserterCount);
      expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    },
  );

  it('adds a far right input belt for Problem 15', () => {
    const design = generateAssemblerDesign(kernelProblems[14]!, {
      beltItemsPerSecond: 30,
      inserterItemsPerSecond: 12,
      longInserterItemsPerSecond: 6,
    });
    const entities = design?.columns[0].entities ?? [];

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

  it('has no solution for multiple solid outputs or simultaneous fluid input and output', () => {
    expect(generateAssemblerDesign(kernelProblems[5]!, throughput)).toBeUndefined();
    expect(generateAssemblerDesign(kernelProblems[16]!, throughput)).toBeUndefined();
  });
});
