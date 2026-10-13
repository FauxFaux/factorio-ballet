import loadHighs from 'highs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDataset } from '../../src/dataset/index.ts';
import { spaceAge } from '../../src/dataset/catalogue/space-age.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../../src/data/inserter-throughput.ts';
import { recipeKernelProblem } from '../../src/compute/modules.ts';
import { kernelLayoutOptions } from '../../src/compute/kernel-layout-options.ts';
import {
  planCellPlacements,
  baselineCellPlacements,
} from '../../src/compute/placement-plan/index.ts';
import { connectStationFlows } from '../../src/compute/module-connections.ts';
import { assignModulePorts } from '../../src/compute/module-port-connections.ts';
import type { PlacementDemand } from '../../src/compute/placement-plan/recipes.ts';
import type { ResourceId } from '../../src/types.ts';
import { processingUnitProblem } from '../../scripts/placement-milp-example.ts';

let highs: Awaited<ReturnType<typeof loadHighs>>;
let demands: PlacementDemand[];
beforeAll(async () => {
  highs = await loadHighs();
  const ds = createDataset('space-age-2.1.19', await spaceAge());
  const belt = ds.data.belts['turbo-transport-belt'];
  const throughput = {
    beltItemsPerSecond: belt.itemsPerSecond,
    inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, 1, belt),
    longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, 1, belt, 2),
  };
  demands = processingUnitProblem.recipes.map((recipe) => {
    const rates = (side: 'inputs' | 'outputs') =>
      new Map(recipe[side].map((rate) => [rate.material as ResourceId, rate.rate / recipe.count]));
    const problem = recipeKernelProblem(
      ds.data,
      recipe.recipe,
      recipe.recipe.startsWith('casting') ? 'foundry' : 'electromagnetic-plant',
      rates('inputs'),
      rates('outputs'),
    );
    return {
      problem,
      machineCount: recipe.count,
      options: kernelLayoutOptions(problem, throughput, recipe.count, belt.undergroundLength - 1)
        .options,
    };
  });
}, 15000);

describe('default joint module maker', () => {
  it('emits real supported kernels with conserved retained flows attached to every port', () => {
    const plan = planCellPlacements(highs, demands, 60, { timeLimit: 2 });
    expect(plan.diagnostics.solver).toBe('highs');
    for (const demand of demands) {
      const modules = plan.modules.filter(
        (module) => module.recipe === demand.problem.assemblers[0].name,
      );
      expect(modules.reduce((sum, module) => sum + module.workload!, 0)).toBeCloseTo(
        demand.machineCount!,
        6,
      );
      for (const module of modules) {
        expect(module.estimated).not.toBe(true);
        expect(module.machineCount).toBeGreaterThanOrEqual(module.workload! - 1e-6);
        expect(module.size.height).toBeLessThanOrEqual(100);
        expect(
          demand.options.some(
            (option) =>
              module.machineCount % option.buildingsPerRepeat === 0 &&
              module.machineCount <= option.maxBuildingsPerColumn,
          ),
        ).toBe(true);
      }
    }
    const baseline = baselineCellPlacements(demands, 60);
    expect(plan.score).toBeLessThanOrEqual(baseline.score + 1e-4);
    const attached = connectStationFlows(
      plan.flows,
      processingUnitProblem.inputs.map((rate) => rate.material as ResourceId),
      processingUnitProblem.outputs.map((rate) => rate.material as ResourceId),
    );
    expect(attached.unmetInputs).toEqual([]);
    expect(attached.unusedOutputs).toEqual([]);
    expect(assignModulePorts(plan.modules, attached).unattached).toEqual([]);
  }, 10000);

  it('keeps pair repeats whole and prefers one extra building to an estimated odd remainder', () => {
    const circuit = demands.find(
      (demand) => demand.problem.assemblers[0].name === 'electronic-circuit',
    )!;
    const pair: PlacementDemand = {
      ...circuit,
      machineCount: 4.1,
      options: circuit.options.filter((option) => option.buildingsPerRepeat === 2),
    };
    expect(pair.options.length).toBeGreaterThan(0);
    const plan = planCellPlacements(highs, [pair], 60);
    expect(plan.diagnostics.solver).toBe('highs');
    expect(plan.modules.reduce((sum, module) => sum + module.machineCount, 0)).toBe(6);
    expect(plan.modules.every((module) => !module.estimated && module.machineCount % 2 === 0)).toBe(
      true,
    );
    const strict = planCellPlacements(highs, [pair], 60, { maxExtraBuildings: 0 });
    expect(strict.modules.some((module) => module.estimated)).toBe(true);
    expect(strict.modules.reduce((sum, module) => sum + module.machineCount, 0)).toBe(5);
  });

  it('leaves unresolved and empty cells empty and keeps unsupported geometry explicitly estimated', () => {
    expect(planCellPlacements(highs, [], 60).modules).toEqual([]);
    expect(
      planCellPlacements(highs, [{ ...demands[0], machineCount: undefined }], 60).modules,
    ).toEqual([]);
    const estimated = planCellPlacements(
      highs,
      [{ ...demands[0], options: [], machineCount: 0.5 }],
      60,
    );
    expect(estimated.modules.every((module) => module.estimated)).toBe(true);
    expect(estimated.modules.reduce((sum, module) => sum + module.workload!, 0)).toBeCloseTo(0.5);
    const tiny = planCellPlacements(
      highs,
      [{ ...demands[0], options: [], machineCount: 0.00005 }],
      60,
    );
    expect(tiny.diagnostics.solver).toBe('highs');
    expect(tiny.modules.reduce((sum, module) => sum + module.workload!, 0)).toBeCloseTo(0.00005, 9);
  });

  it('keeps undeclared station overflow explicit instead of treating it as an allowed boundary', () => {
    const plan = planCellPlacements(highs, [demands[0]], 60, {
      boundary: { inputs: [], outputs: [] },
    });
    expect(plan.diagnostics).toMatchObject({ solver: 'baseline', status: 'fallback' });
    expect(plan.diagnostics.reason).toContain('Undeclared');
    expect(connectStationFlows(plan.flows, [], []).unmetInputs.length).toBeGreaterThan(0);
  });

  it('limits stacks to validated copies even if an advertised maximum is larger', () => {
    const circuit = demands.find(
      (demand) => demand.problem.assemblers[0].name === 'electronic-circuit',
    )!;
    const pair: PlacementDemand = {
      ...circuit,
      machineCount: 4.1,
      options: circuit.options
        .filter((option) => option.buildingsPerRepeat === 2)
        .map((option) => ({
          ...option,
          result: {
            ...option.result,
            validation: { ...option.result.validation, supportedCopies: 1 },
          },
        })),
    };
    const plan = planCellPlacements(highs, [pair], 60);
    expect(plan.diagnostics.solver).toBe('highs');
    expect(
      plan.modules.every(
        (module) => !module.estimated && module.machineCount === 2 && module.copies === 1,
      ),
    ).toBe(true);
    expect(plan.modules.reduce((sum, module) => sum + module.machineCount, 0)).toBe(6);
  });

  it('produces the same deterministic plan regardless of recipe ordering', () => {
    const options = { extraSlots: 0, timeLimit: 2 };
    const first = planCellPlacements(highs, demands, 60, options);
    const second = planCellPlacements(highs, demands.toReversed(), 60, options);
    expect(second.modules).toEqual(first.modules);
    expect(second.flows).toEqual(first.flows);
  }, 10000);
});
