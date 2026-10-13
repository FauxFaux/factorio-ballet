import { spaceAge } from '../src/dataset/catalogue/space-age.ts';
import { createDataset } from '../src/dataset/index.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../src/data/inserter-throughput.ts';
import { recipeKernelProblem } from '../src/compute/modules.ts';
import { kernelLayoutOptions } from '../src/compute/kernel-layout-options.ts';
import { planCellPlacements } from '../src/compute/placement-plan/index.ts';
import loadHighs from 'highs';
import wasmUrl from 'highs/runtime?url';
import type { PlacementDemand } from '../src/compute/placement-plan/recipes.ts';
import type { ResourceId } from '../src/types.ts';

/** Loaded by the browser benchmark through Vite; actual kernels are searched before timing. */
export async function runPlacementBenchmarks() {
  const highs = await loadHighs({ locateFile: () => wasmUrl });
  const ds = createDataset('space-age-2.1.19', await spaceAge());
  const belt = ds.data.belts['turbo-transport-belt'];
  const throughput = {
    beltItemsPerSecond: belt.itemsPerSecond,
    inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, 1, belt),
    longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, 1, belt, 2),
  };
  const definitions: [
    string,
    number,
    Partial<Record<ResourceId, number>>,
    Partial<Record<ResourceId, number>>,
  ][] = [
    [
      'processing-unit',
      24,
      { 'item:electronic-circuit': 7, 'item:advanced-circuit': 0.7, 'fluid:sulfuric-acid': 1.75 },
      { 'item:processing-unit': 0.7 },
    ],
    [
      'advanced-circuit',
      14.4,
      { 'item:copper-cable': 7 / 3, 'item:electronic-circuit': 7 / 6, 'item:plastic-bar': 7 / 6 },
      { 'item:advanced-circuit': 7 / 6 },
    ],
    [
      'electronic-circuit',
      13.2,
      { 'item:copper-cable': 21, 'item:iron-plate': 7 },
      { 'item:electronic-circuit': 14 },
    ],
    [
      'casting-copper-cable',
      10.7617728531856,
      { 'fluid:molten-copper': 38 },
      { 'item:copper-cable': 28.88 },
    ],
    [
      'casting-iron',
      10.238227146814406,
      { 'fluid:molten-iron': 47.5 },
      { 'item:iron-plate': 9.025 },
    ],
  ];
  const setupStarted = performance.now();
  const real = definitions.map(([recipe, machineCount, inputs, outputs]) => {
    const rates = (values: Partial<Record<ResourceId, number>>) =>
      new Map(Object.entries(values).map(([id, rate]) => [id as ResourceId, rate!]));
    const problem = recipeKernelProblem(
      ds.data,
      recipe,
      recipe.startsWith('casting') ? 'foundry' : 'electromagnetic-plant',
      rates(inputs),
      rates(outputs),
    );
    return {
      problem,
      machineCount,
      options: kernelLayoutOptions(problem, throughput, machineCount, belt.undergroundLength - 1)
        .options,
    };
  });
  const kernelSetupMs = performance.now() - setupStarted;
  const synthetic = (chain: boolean): PlacementDemand[] =>
    Array.from({ length: 10 }, (_, i) => ({
      machineCount: 25,
      options: [],
      problem: {
        assemblers: [
          {
            name: `synthetic-${i}`,
            size: { width: 3, height: 3 },
            inputPerSecond: {},
            outputPerSecond: {},
          },
        ],
        inputs: { solids: { [`item:material-${chain ? i : 0}`]: 1 }, fluids: {} },
        outputs: { solids: { [`item:material-${chain ? i + 1 : i + 10}`]: 1 }, fluids: {} },
        design: { columns: [] },
      },
    }));
  const summaries = [];
  for (const [name, demands] of [
    ['processing-unit', real],
    ['250-building-chain', synthetic(true)],
    ['250-building-shared-import', synthetic(false)],
  ] as const) {
    planCellPlacements(highs, demands, belt.itemsPerSecond);
    const times = [];
    let plan = planCellPlacements(highs, demands, belt.itemsPerSecond);
    for (let trial = 0; trial < 5; trial++) {
      const start = performance.now();
      plan = planCellPlacements(highs, demands, belt.itemsPerSecond);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    summaries.push({
      name,
      medianMs: times[2],
      maxMs: times.at(-1),
      diagnostics: plan.diagnostics,
      placements: plan.modules.length,
      buildings: plan.modules.reduce((sum, module) => sum + module.machineCount, 0),
      handoffs: plan.flows.connections.length,
      splits: plan.modules.map((module) => ({
        recipe: module.recipe,
        buildings: module.machineCount,
        workload: module.workload,
      })),
    });
  }
  return { userAgent: navigator.userAgent, throughput, kernelSetupMs, summaries };
}
