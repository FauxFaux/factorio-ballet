import { describe, expect, it } from 'vitest';
import type { KernelProblem } from '../../src/compute/kernel-problems.ts';
import { kernelLayoutOptions } from '../../src/compute/kernel-layout-options.ts';
import { recipeKernelProblem } from '../../src/compute/modules.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../../src/data/inserter-throughput.ts';
import { defaultDataset } from '../with-bobang.ts';

describe('processing electronics kernel options', () => {
  it('finds a doubled column for the fixed seventeen-building demand', () => {
    const data = defaultDataset.data;
    const recipe = 'bob-processing-electronics';
    const machine = 'bob-assembling-machine-6';
    const belt = data.belts['bob-ultimate-transport-belt'];
    const problem = recipeKernelProblem(
      data,
      recipe,
      machine,
      new Map([
        ['fluid:angels-liquid-sulfuric-acid', 476 / 17],
        ['item:bob-silicon-wafer', 285.6 / 17],
        ['item:bob-silicon-nitride', 47.6 / 17],
        ['item:angels-wire-platinum', 238 / 17],
      ]),
      new Map([['item:bob-processing-electronics', 523.6 / 17]]),
    );
    const { options } = kernelLayoutOptions(
      problem,
      {
        beltItemsPerSecond: belt.itemsPerSecond,
        inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(defaultDataset, 1, belt),
        longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(
          defaultDataset,
          1,
          belt,
          2,
        ),
      },
      17,
      belt.undergroundLength - 1,
    );

    expect(options.some(({ requestedCopies }) => requestedCopies === 2)).toBe(true);
  });
  it('retains both regular and HIGH solutions at two repeats for the exported problem', () => {
    const inputs = {
      solids: { 'item:1': 16.799999999999997, 'item:2': 14, 'item:3': 2.8 },
      fluids: { 'fluid:1': 28 },
    };
    const outputs = { solids: { 'item:4': 30.799999999999997 }, fluids: {} };
    const problem: KernelProblem = {
      inputs,
      outputs,
      assemblers: [
        {
          name: 'Assembler 2',
          inputPerSecond: { ...inputs.solids, ...inputs.fluids },
          outputPerSecond: outputs.solids,
          size: { width: 3, height: 3 },
          fluidBoxes: [
            {
              productionType: 'input',
              connections: [
                { position: { x: 0, y: -1 }, direction: 'north', flowDirection: 'input' },
              ],
            },
            {
              productionType: 'output',
              connections: [
                { position: { x: 0, y: 1 }, direction: 'south', flowDirection: 'output' },
              ],
            },
          ],
          fluidIngredients: [{ resource: 'fluid:1' }],
          fluidProducts: [],
        },
      ],
      design: { columns: [] },
    };
    const { options } = kernelLayoutOptions(
      problem,
      {
        beltItemsPerSecond: 75,
        inserterItemsPerSecond: 37.5,
        longInserterItemsPerSecond: 18.8,
      },
      17,
      22,
    );
    const regular = options.find(
      ({ name, requestedCopies }) => name === 'General' && requestedCopies === 2,
    );
    expect(regular).toBeDefined();
    expect(regular!.columns).toHaveLength(9);
    expect(regular!.maxBuildingsPerColumn).toBe(2);
    const doubled = options.find(
      ({ name, requestedCopies }) => name === 'HIGH single' && requestedCopies === 2,
    );
    expect(doubled).toMatchObject({
      result: { candidate: { width: 6, pitch: 7 }, validation: { supportedCopies: 2 } },
      buildingsPerRepeat: 1,
      maxBuildingsPerColumn: 2,
    });
    expect(doubled!.columns).toHaveLength(9);
    expect(doubled!.columns.map(({ machineCount }) => machineCount)).toEqual([
      2, 2, 2, 2, 2, 2, 2, 2, 1,
    ]);
  });
});
