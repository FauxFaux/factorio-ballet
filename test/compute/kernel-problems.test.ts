import { describe, expect, it } from 'vitest';
import {
  allKernelProblems,
  assemblerProblem,
  kernelProblems,
} from '../../src/compute/kernel-problems.ts';

describe('assemblerProblem', () => {
  it('builds distinct synthetic resources and the matching assembler flow', () => {
    const problem = assemblerProblem({
      assemblerName: 'Chemical plant',
      solidInputs: [5, 8],
      fluidInputs: [200],
      solidOutputs: [2],
      fluidOutputs: [100],
    });

    expect(problem.inputs).toEqual({
      solids: { 'item 1': 5, 'item 2': 8 },
      fluids: { 'fluid 1': 200 },
    });
    expect(problem.outputs).toEqual({
      solids: { 'item 3': 2 },
      fluids: { 'fluid 2': 100 },
    });
    expect(problem.assemblers).toEqual([
      {
        name: 'Chemical plant',
        inputPerSecond: { 'item 1': 5, 'item 2': 8, 'fluid 1': 200 },
        outputPerSecond: { 'item 3': 2, 'fluid 2': 100 },
      },
    ]);
    expect(problem.design).toEqual({ columns: [{ entities: [] }] });
  });

  it('defaults omitted flows to empty and supplies an assembler name', () => {
    const problem = assemblerProblem({});

    expect(problem.inputs).toEqual({ solids: {}, fluids: {} });
    expect(problem.outputs).toEqual({ solids: {}, fluids: {} });
    expect(problem.assemblers[0]?.name).toBe('Assembler 1');
  });
});

describe('kernelProblems', () => {
  it('groups examples by fluid boundary shape', () => {
    expect(Object.keys(kernelProblems)).toEqual([
      'solid',
      'fluidInput',
      'fluidOutput',
      'fluidInputAndOutput',
    ]);
    expect(kernelProblems.solid).toHaveLength(6);
    expect(kernelProblems.fluidInput).toHaveLength(4);
    expect(kernelProblems.fluidOutput).toHaveLength(6);
    expect(kernelProblems.fluidInputAndOutput).toHaveLength(4);
    expect(allKernelProblems).toHaveLength(20);
  });

  it('uses 200 per second for every example fluid', () => {
    for (const problem of allKernelProblems) {
      expect(Object.values(problem.inputs.fluids).every((rate) => rate === 200)).toBe(true);
      expect(Object.values(problem.outputs.fluids).every((rate) => rate === 200)).toBe(true);
    }
  });

  it('gives each assembler its complete boundary flow', () => {
    for (const problem of allKernelProblems) {
      expect(problem.assemblers[0]?.inputPerSecond).toEqual({
        ...problem.inputs.solids,
        ...problem.inputs.fluids,
      });
      expect(problem.assemblers[0]?.outputPerSecond).toEqual({
        ...problem.outputs.solids,
        ...problem.outputs.fluids,
      });
    }
  });
});
