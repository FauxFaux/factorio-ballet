import type { Highs } from 'highs';
import type { ResourceId } from '../../types.ts';
import type { FactoryModule } from '../modules.ts';
import type { ModuleFlowAllocation } from '../module-connections.ts';
import { EPSILON, placementRecipes, type PlacementDemand } from './recipes.ts';
import { searchModuleFlows } from './flow-search.ts';
import {
  scoreSplit,
  solveSplits,
  type SplitProblem,
  type SplitOptions,
  type SplitCandidate,
} from './milp.ts';

function asCandidate(modules: FactoryModule[], flows: ModuleFlowAllocation): SplitCandidate {
  return {
    placements: modules.map((module) => ({
      id: module.id,
      recipe: module.recipe,
      workload: module.workload!,
      buildings: module.machineCount,
      layout: {
        size: module.size,
        capacity: module.machineCount,
        buildings: module.machineCount,
        penalty: module.estimated ? 0.1 : 0,
      },
    })),
    flows: [
      ...flows.connections.map((flow) => ({
        producer: flow.producerId,
        consumer: flow.consumerId,
        material: flow.resource,
        rate: flow.rate,
      })),
      ...flows.unmetInputs.map((flow) => ({
        producer: 'import',
        consumer: flow.moduleId,
        material: flow.resource,
        rate: flow.rate,
      })),
      ...flows.unusedOutputs.map((flow) => ({
        producer: flow.moduleId,
        consumer: 'export',
        material: flow.resource,
        rate: flow.rate,
      })),
    ],
  };
}

export interface PlacementPlan {
  modules: FactoryModule[];
  flows: ModuleFlowAllocation;
  score: number;
  diagnostics: {
    solver: 'highs' | 'baseline';
    status: string;
    elapsedMs?: number;
    scoreGap?: number;
    lowerBound?: number;
    reason?: string;
  };
}
export interface PlacementPlanOptions extends SplitOptions {
  /** Only these declared resources may connect to stations. Omit for standalone planning. */
  boundary?: { inputs: readonly ResourceId[]; outputs: readonly ResourceId[] };
}

/** A feasible, cheap initial layout while the asynchronous joint solver is loading/running.
 * Keep unresolved gross remainders explicit; station assignment still checks declarations. */
export function baselineCellPlacements(
  demands: readonly PlacementDemand[],
  beltCapacity: number,
): PlacementPlan {
  const recipes = placementRecipes(demands, beltCapacity);
  const modules = recipes.flatMap((recipe) =>
    recipe
      .partition(recipe.installed)!
      .map((count, index) =>
        recipe.build(count, (recipe.workload * count) / recipe.installed, index)!,
      ),
  );
  const resources = [
    ...new Set(
      modules.flatMap((module) => [...Object.keys(module.inputs), ...Object.keys(module.outputs)]),
    ),
  ] as ResourceId[];
  const flows = searchModuleFlows(modules, resources, 24).allocation;
  const problem: SplitProblem = {
    inputs: [],
    outputs: [],
    recipes: recipes.map((recipe) => ({
      recipe: recipe.recipe,
      count: recipe.workload,
      inputs: [],
      outputs: [],
      layoutOptions: [],
    })),
  };
  return {
    modules,
    flows,
    score: scoreSplit(problem, asCandidate(modules, flows), beltCapacity).score,
    diagnostics: { solver: 'baseline', status: 'pending' },
  };
}

/** Default whole-cell module maker. Choose actual supported repeats jointly with workloads
 * and retain the selected flows for station and port assignment. Run this in a worker in the UI. */
export function planCellPlacements(
  highs: Highs,
  demands: readonly PlacementDemand[],
  beltCapacity: number,
  options: PlacementPlanOptions = {},
): PlacementPlan {
  const maxExtraBuildings = options.maxExtraBuildings ?? 6;
  const recipes = placementRecipes(demands, beltCapacity, maxExtraBuildings);
  const fallback = (reason: string): PlacementPlan => ({
    ...baselineCellPlacements(demands, beltCapacity),
    diagnostics: { solver: 'baseline', status: 'fallback', reason },
  });
  if (!recipes.length)
    return {
      modules: [],
      flows: { connections: [], unmetInputs: [], unusedOutputs: [] },
      score: 0,
      diagnostics: { solver: 'highs', status: 'empty' },
    };
  const rates = (recipe: (typeof recipes)[number], side: 'inputs' | 'outputs') =>
    Object.entries({ ...recipe.problem[side].solids, ...recipe.problem[side].fluids })
      .filter(([, rate]) => rate > EPSILON)
      .map(([material, rate]) => ({ material, rate: rate * recipe.workload }));
  const problem: SplitProblem = {
    recipes: recipes.map((recipe) => ({
      recipe: recipe.recipe,
      count: recipe.workload,
      inputs: rates(recipe, 'inputs'),
      outputs: rates(recipe, 'outputs'),
      layoutOptions: recipe.templates.map((template) => ({
        size: template.size,
        capacity: template.machineCount,
        buildings: template.machineCount,
        penalty: template.estimated
          ? demands.find((demand) => demand.problem.assemblers[0]?.name === recipe.recipe)?.options
              .length
            ? 100
            : 0.1
          : 0,
      })),
    })),
    inputs: [],
    outputs: [],
  };
  const materials = [
    ...new Set(
      problem.recipes.flatMap((recipe) =>
        [...recipe.inputs, ...recipe.outputs].map((rate) => rate.material),
      ),
    ),
  ].sort();
  for (const material of materials) {
    const total = (side: 'inputs' | 'outputs') =>
      problem.recipes.reduce(
        (sum, recipe) =>
          sum +
          recipe[side]
            .filter((rate) => rate.material === material)
            .reduce((sum, rate) => sum + rate.rate, 0),
        0,
      );
    const difference = total('inputs') - total('outputs');
    if (Math.abs(difference) <= EPSILON) continue;
    const side = difference > 0 ? 'inputs' : 'outputs';
    if (options.boundary && !options.boundary[side].includes(material as ResourceId))
      return fallback(`Undeclared ${side === 'inputs' ? 'import' : 'export'}: ${material}`);
    problem[side].push({ material, rate: Math.abs(difference) });
  }
  // Bound model construction as well as solver runtime for very large or dense cells.
  const slots = problem.recipes.map(
    (recipe) =>
      Math.ceil(recipe.count / Math.max(...recipe.layoutOptions.map((layout) => layout.capacity))) +
      (options.extraSlots ?? 1),
  );
  const edgeCount = materials.reduce((sum, material) => {
    const count = (side: 'inputs' | 'outputs') =>
      problem.recipes.reduce(
        (sum, recipe, index) =>
          sum + (recipe[side].some((rate) => rate.material === material) ? slots[index] : 0),
        0,
      );
    return sum + count('inputs') * count('outputs');
  }, 0);
  if (slots.reduce((a, b) => a + b, 0) > 128 || edgeCount > 2000)
    return fallback('Cell exceeds the joint model size limit');
  const baseline = baselineCellPlacements(demands, beltCapacity);
  const result = solveSplits(highs, problem, {
    ...options,
    beltCapacity,
    seed: asCandidate(baseline.modules, baseline.flows),
    extraSlots: options.extraSlots ?? 1,
    timeLimit: options.timeLimit ?? 1,
  });
  if (!result.candidate)
    return fallback(`HiGHS ${result.diagnostics.status}: no feasible incumbent`);
  const modules = result.candidate.placements.map((placement) => {
    const recipe = recipes.find((recipe) => recipe.recipe === placement.recipe)!;
    const module = recipe.build(placement.buildings, placement.workload, 0);
    if (!module)
      throw new Error(`Unsupported selected repeat: ${placement.recipe}/${placement.buildings}`);
    return { ...module, id: placement.id };
  });
  for (const recipe of recipes) {
    const assigned = modules
      .filter((module) => module.recipe === recipe.recipe)
      .reduce((sum, module) => sum + module.workload!, 0);
    if (Math.abs(assigned - recipe.workload) > Math.min(1e-6, recipe.workload * 1e-6))
      return fallback('Incumbent failed recipe workload conservation');
  }
  const flows: ModuleFlowAllocation = { connections: [], unmetInputs: [], unusedOutputs: [] };
  for (const flow of result.candidate.flows) {
    const resource = flow.material as ResourceId;
    if (flow.producer === 'import')
      flows.unmetInputs.push({ moduleId: flow.consumer, resource, rate: flow.rate });
    else if (flow.consumer === 'export')
      flows.unusedOutputs.push({ moduleId: flow.producer, resource, rate: flow.rate });
    else
      flows.connections.push({
        producerId: flow.producer,
        consumerId: flow.consumer,
        resource,
        rate: flow.rate,
      });
  }
  // Numerical incumbents must still conserve the actual emitted module/port rates.
  for (const module of modules)
    for (const side of ['inputs', 'outputs'] as const)
      for (const [resource, required] of Object.entries(module[side])) {
        const internal = flows.connections
          .filter(
            (flow) =>
              flow.resource === resource &&
              (side === 'inputs' ? flow.consumerId : flow.producerId) === module.id,
          )
          .reduce((sum, flow) => sum + flow.rate, 0);
        const external = (side === 'inputs' ? flows.unmetInputs : flows.unusedOutputs)
          .filter((flow) => flow.resource === resource && flow.moduleId === module.id)
          .reduce((sum, flow) => sum + flow.rate, 0);
        if (Math.abs(internal + external - required) > 1e-6 * Math.max(1, required))
          return fallback('Incumbent failed module flow conservation');
      }
  return {
    modules,
    flows,
    score: result.scored!.score,
    diagnostics: {
      solver: 'highs',
      status: result.diagnostics.status,
      elapsedMs: result.diagnostics.elapsedMs,
      lowerBound: result.diagnostics.lowerBound,
      scoreGap: 'scoreGap' in result.diagnostics ? result.diagnostics.scoreGap : undefined,
    },
  };
}
