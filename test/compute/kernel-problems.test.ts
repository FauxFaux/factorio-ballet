import { describe, expect, it } from 'vitest';
import {
  airFilterProblem,
  allKernelProblems,
  assemblerProblem,
  kernelProblems,
} from '../../src/compute/kernel-problems.ts';
import { staticData } from '../../src/data/decode.ts';

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

  it('uses Assembler 2 and its generated 3x3 fluid geometry for fluid problems', () => {
    const assembler = assemblerProblem({ fluidInputs: [200], fluidOutputs: [100] }).assemblers[0];

    expect(assembler).toMatchObject({
      name: 'Assembler 2',
      size: { width: 3, height: 3 },
      fluidBoxes: [
        {
          productionType: 'input',
          connections: [{ position: { x: 0, y: -1 }, direction: 'north', flowDirection: 'input' }],
        },
        {
          productionType: 'output',
          connections: [{ position: { x: 0, y: 1 }, direction: 'south', flowDirection: 'output' }],
        },
      ],
    });
    expect(assembler?.size).toEqual(staticData.machines['assembling-machine-2'].size);
    expect(assembler?.fluidBoxes).toEqual(staticData.machines['assembling-machine-2'].fluidBoxes);
  });
});

describe('kernelProblems', () => {
  it('groups examples by fluid boundary shape', () => {
    expect(Object.keys(kernelProblems)).toEqual([
      'solid',
      'fluidInput',
      'fluidOutput',
      'fluidInputAndOutput',
      'airFilter',
    ]);
    expect(kernelProblems.solid).toHaveLength(6);
    expect(kernelProblems.fluidInput).toHaveLength(4);
    expect(kernelProblems.fluidOutput).toHaveLength(7);
    expect(kernelProblems.fluidInputAndOutput).toHaveLength(4);
    expect(kernelProblems.airFilter).toHaveLength(3);
    expect(allKernelProblems).toHaveLength(24);
  });

  it('includes a fluid-producing recipe with no input resources', () => {
    const problem = kernelProblems.fluidOutput[6]!;

    expect(problem.inputs).toEqual({ solids: {}, fluids: {} });
    expect(problem.outputs).toEqual({ solids: {}, fluids: { 'fluid 1': 200 } });
    expect(problem.assemblers[0]?.inputPerSecond).toEqual({});
  });

  it('generates air filters with centred south input and north output ports', () => {
    for (const size of [
      { width: 3, height: 5 },
      { width: 5, height: 3 },
      { width: 5, height: 5 },
    ]) {
      const problem = airFilterProblem(size);
      const assembler = problem.assemblers[0];

      expect(assembler?.size).toEqual(size);
      expect(assembler?.fluidBoxes).toEqual([
        {
          productionType: 'input',
          connections: [
            {
              position: { x: 0, y: Math.floor(size.height / 2) },
              direction: 'south',
              flowDirection: 'input',
            },
          ],
        },
        {
          productionType: 'output',
          connections: [
            {
              position: { x: 0, y: -Math.floor(size.height / 2) },
              direction: 'north',
              flowDirection: 'output',
            },
          ],
        },
      ]);
      expect(problem.inputs.fluids).toEqual({ 'fluid 1': 200 });
      expect(problem.outputs.fluids).toEqual({ 'fluid 2': 200 });
    }
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
