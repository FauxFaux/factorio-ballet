import { searchModuleFlows } from '../src/compute/placement-plan/flow-search.ts';
import type { FactoryModule } from '../src/compute/modules.ts';
import type { ResourceId } from '../src/types.ts';
import type { SplitCandidate, SplitProblem } from './placement-milp.ts';

/** Fixed integer partitions using the existing sparse allocator, for comparison under
 * exactly the same abstract capacity envelopes and scoring as the MILP experiment. */
export function fixedSplitBaseline(problem: SplitProblem, balanced: boolean): SplitCandidate {
  const placements = problem.recipes.flatMap((recipe, recipeIndex) => {
    const installed = Math.ceil(recipe.count - 1e-8);
    const maximum = Math.max(...recipe.layoutOptions.map((layout) => layout.capacity));
    const length = Math.ceil(installed / maximum);
    return Array.from({ length }, (_, index) => {
      const buildings = balanced
        ? Math.floor(installed / length) + Number(index < installed % length)
        : Math.min(maximum, installed - index * maximum);
      const layout = recipe.layoutOptions
        .filter((layout) => layout.capacity >= buildings)
        .toSorted((a, b) => a.size.width * a.size.height - b.size.width * b.size.height)[0];
      return {
        id: `r${recipeIndex}s${index}`,
        recipe: recipe.recipe,
        workload: (recipe.count * buildings) / installed,
        buildings,
        layout,
      };
    });
  });
  const modules: FactoryModule[] = placements.map((placement) => {
    const recipe = problem.recipes.find((recipe) => recipe.recipe === placement.recipe)!;
    const rates = (side: 'inputs' | 'outputs') =>
      Object.fromEntries(
        recipe[side].map((rate) => [
          rate.material,
          (rate.rate * placement.workload) / recipe.count,
        ]),
      ) as Record<ResourceId, number>;
    return {
      id: placement.id,
      recipe: placement.recipe,
      machineCount: placement.buildings,
      workload: placement.workload,
      copies: 1,
      size: placement.layout.size,
      ports: [],
      inputs: rates('inputs'),
      outputs: rates('outputs'),
      estimated: true,
    };
  });
  const resources = [
    ...new Set(
      problem.recipes.flatMap((recipe) =>
        [...recipe.inputs, ...recipe.outputs].map((rate) => rate.material as ResourceId),
      ),
    ),
  ];
  const allocation = searchModuleFlows(modules, resources, 1000).allocation;
  return {
    placements,
    flows: [
      ...allocation.connections.map((flow) => ({
        producer: flow.producerId,
        consumer: flow.consumerId,
        material: flow.resource,
        rate: flow.rate,
      })),
      ...allocation.unmetInputs.map((flow) => ({
        producer: 'import',
        consumer: flow.moduleId,
        material: flow.resource,
        rate: flow.rate,
      })),
      ...allocation.unusedOutputs.map((flow) => ({
        producer: flow.moduleId,
        consumer: 'export',
        material: flow.resource,
        rate: flow.rate,
      })),
    ],
  };
}
