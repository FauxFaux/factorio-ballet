import { describe, expect, it } from 'vitest';
import { generateAssemblerDesign } from '../src/assembler-design.ts';
import { entityPositionStatuses } from '../src/components/design/design-entities.tsx';
import { designBounds } from '../src/components/design/design-preview.tsx';
import { kernelProblems } from '../src/kernel-problems.ts';

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

  it('has no solution for Problem 3 because its input needs too many inserters', () => {
    expect(generateAssemblerDesign(kernelProblems[2]!, throughput)).toBeUndefined();
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

  it('has no solution for fluid transport or multiple solid outputs', () => {
    expect(generateAssemblerDesign(kernelProblems[5]!, throughput)).toBeUndefined();
    expect(generateAssemblerDesign(kernelProblems[6]!, throughput)).toBeUndefined();
  });
});
