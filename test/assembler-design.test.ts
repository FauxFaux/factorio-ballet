import { describe, expect, it } from 'vitest';
import { generateAssemblerDesign } from '../src/assembler-design.ts';
import { entityPositionStatuses } from '../src/components/design/design-entities.tsx';
import { kernelProblems } from '../src/kernel-problems.ts';

describe('generateAssemblerDesign', () => {
  it('uses one input inserter for Problem 1', () => {
    const design = generateAssemblerDesign(kernelProblems[0]!);

    expect(design?.columns[0].entities.filter((entity) => entity.kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
    ]);
    expect(design?.columns[0].entities.filter((entity) => entity.kind === 'belt')).toEqual([
      { kind: 'belt', position: { x: 0, y: 0 }, direction: 'north' },
      { kind: 'belt', position: { x: 0, y: 1 }, direction: 'north' },
      { kind: 'belt', position: { x: 0, y: 2 }, direction: 'north' },
      { kind: 'belt', position: { x: 6, y: 0 }, direction: 'south' },
      { kind: 'belt', position: { x: 6, y: 1 }, direction: 'south' },
      { kind: 'belt', position: { x: 6, y: 2 }, direction: 'south' },
    ]);
  });

  it('uses two input inserters for Problem 2 without overlapping entities', () => {
    const design = generateAssemblerDesign(kernelProblems[1]!);
    const entities = design?.columns[0].entities ?? [];

    expect(entities.filter((entity) => entity.kind === 'inserter')).toHaveLength(3);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('has no solution for Problem 3 because its input needs too many inserters', () => {
    expect(generateAssemblerDesign(kernelProblems[2]!)).toBeUndefined();
  });

  it('has no solution for fluid transport or multiple solid outputs', () => {
    expect(generateAssemblerDesign(kernelProblems[5]!)).toBeUndefined();
    expect(generateAssemblerDesign(kernelProblems[6]!)).toBeUndefined();
  });
});
