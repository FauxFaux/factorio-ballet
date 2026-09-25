import { describe, expect, it } from 'vitest';
import {
  airFilterProblem,
  allKernelProblems,
  assemblerProblem,
  kernelMachineChoices,
  kernelProblems,
  machineProblem,
} from '../../src/compute/kernel-problems.ts';
import { normalizeTileDesignInput } from '../../src/compute/tile-design/problem.ts';
import type { TileDesignOptions } from '../../src/compute/tile-design/types.ts';
import { defaultDataset } from '../../src/dataset';

const problems = kernelProblems(defaultDataset.data);
const allProblems = allKernelProblems(defaultDataset.data);

const tileOptions: TileDesignOptions = {
  transport: {
    beltLaneCapacity: 15,
    undergroundBeltReach: 4,
    undergroundPipeReach: 10,
    inserters: [{ id: 'ordinary', capacity: 8, reach: 1 }],
    fluidThroughput: 'unlimited',
  },
  envelope: { maxWidth: 16, maxPitch: 12, primitives: ['surface'], maxStates: 1000 },
};

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
      solids: { 'item:1': 5, 'item:2': 8 },
      fluids: { 'fluid:1': 200 },
    });
    expect(problem.outputs).toEqual({
      solids: { 'item:3': 2 },
      fluids: { 'fluid:2': 100 },
    });
    expect(problem.assemblers).toEqual([
      {
        name: 'Chemical plant',
        inputPerSecond: { 'item:1': 5, 'item:2': 8, 'fluid:1': 200 },
        outputPerSecond: { 'item:3': 2, 'fluid:2': 100 },
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
    expect(assembler?.size).toEqual(defaultDataset.data.machines['assembling-machine-2'].size);
    expect(assembler?.fluidBoxes).toEqual(
      defaultDataset.data.machines['assembling-machine-2'].fluidBoxes,
    );
  });

  it('keeps Assembler 2 geometry when it is selected without fluid flows', () => {
    const assembler = assemblerProblem({ assemblerName: 'Assembler 2', solidInputs: [5] })
      .assemblers[0];

    expect(assembler?.size).toEqual({ width: 3, height: 3 });
    expect(assembler?.fluidBoxes).toEqual(
      defaultDataset.data.machines['assembling-machine-2'].fluidBoxes,
    );
  });

  it('assigns multiple synthetic fluids to the machine ports for tile design', () => {
    const problem = machineProblem(defaultDataset.data, 'chemical-plant', {
      fluidInputs: [200, 200],
      fluidOutputs: [200],
    });
    expect(problem.assemblers[0]?.fluidIngredients).toEqual([
      { resource: 'fluid:1' },
      { resource: 'fluid:2' },
    ]);
    expect(problem.assemblers[0]?.fluidProducts).toEqual([{ resource: 'fluid:3' }]);

    const normalized = normalizeTileDesignInput(problem, tileOptions);
    expect(normalized.success).toBe(true);
    if (normalized.success) {
      expect(
        normalized.input.machines[0]?.inputs.fluids.map(({ boxIndex, resource }) => ({
          boxIndex,
          resource,
        })),
      ).toEqual([
        { boxIndex: 0, resource: 'fluid:1' },
        { boxIndex: 1, resource: 'fluid:2' },
      ]);
    }
  });
});

describe('kernelProblems', () => {
  it('uses the selected machine footprint and ports for custom problems', () => {
    expect(kernelMachineChoices.map(({ label }) => label)).toEqual([
      'Chemical plant',
      'Flare stack',
      'Casting machine',
      'Powderiser',
    ]);
    for (const { value, label, machineId } of kernelMachineChoices) {
      const assembler = machineProblem(defaultDataset.data, value, {
        solidInputs: [1],
        solidOutputs: [1],
      }).assemblers[0];
      expect(assembler).toMatchObject({
        name: label,
        size: defaultDataset.data.machines[machineId].size,
      });
      expect(assembler?.fluidBoxes).toEqual(defaultDataset.data.machines[machineId].fluidBoxes);
    }
  });

  it('groups examples by fluid boundary shape', () => {
    expect(Object.keys(problems)).toEqual([
      'solid',
      'fluidInput',
      'fluidOutput',
      'fluidInputAndOutput',
      'airFilter',
    ]);
    expect(problems.solid).toHaveLength(9);
    expect(problems.fluidInput).toHaveLength(6);
    expect(problems.fluidOutput).toHaveLength(7);
    expect(problems.fluidInputAndOutput).toHaveLength(5);
    expect(problems.airFilter).toHaveLength(3);
    expect(allProblems).toHaveLength(30);
  });

  it('includes the mixed belt, 2×2, flare, and air-separation cases', () => {
    expect(problems.solid[6]?.inputs.solids).toEqual({ 'item:1': 30, 'item:2': 5 });
    expect(problems.solid[7]?.assemblers[0]?.size).toEqual({ width: 2, height: 2 });
    expect(problems.solid[8]?.outputs.solids).toEqual({ 'item:3': 1, 'item:4': 1 });
    expect(problems.fluidInput[4]?.outputs).toEqual({ solids: {}, fluids: {} });
    expect(problems.fluidInputAndOutput[4]?.outputs.fluids).toEqual({
      'fluid:2': 200,
      'fluid:3': 200,
    });
  });

  it('includes a fluid-producing recipe with no input resources', () => {
    const problem = problems.fluidOutput[6]!;

    expect(problem.inputs).toEqual({ solids: {}, fluids: {} });
    expect(problem.outputs).toEqual({ solids: {}, fluids: { 'fluid:1': 200 } });
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
      expect(problem.inputs.fluids).toEqual({ 'fluid:1': 200 });
      expect(problem.outputs.fluids).toEqual({ 'fluid:2': 200 });
    }
  });

  it('uses 200 per second for generic example fluids', () => {
    for (const problem of allProblems.filter(
      (problem) => problem.assemblers[0]?.name !== 'Oxygen flare',
    )) {
      expect(Object.values(problem.inputs.fluids).every((rate) => rate === 200)).toBe(true);
      expect(Object.values(problem.outputs.fluids).every((rate) => rate === 200)).toBe(true);
    }
  });

  it('gives each assembler its complete boundary flow', () => {
    for (const problem of allProblems) {
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
