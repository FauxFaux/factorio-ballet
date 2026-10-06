import type { FactoryModule } from '../modules.ts';
import type { ModuleFlowAllocation } from '../module-connections.ts';
import type { ResourceId } from '../../types.ts';
import { searchModuleFlows } from './flow-search.ts';
import {
  EPSILON,
  partitionWorkloads,
  placementRecipes,
  type PlacementDemand,
  type RecipePlacements,
} from './recipes.ts';

export interface PlacementPlanOptions {
  /** Hard cap relative to the fewest supported placements, never a building allowance. */
  maxPlacementMultiplier?: number;
  maxStates?: number;
  beamWidth?: number;
  flowMaxStates?: number;
}
export interface PlacementPlan {
  modules: FactoryModule[];
  flows: ModuleFlowAllocation;
  score: number;
  diagnostics: {
    exploredStates: number;
    minimumPlacements: number;
    maxPlacements: number;
    stopReason: 'complete' | 'budget';
    /** Candidate generation and beam pruning do not prove a global optimum. */
    optimal: false;
  };
}
interface Candidate {
  rows: FactoryModule[][];
  modules: FactoryModule[];
  flows: ModuleFlowAllocation;
  score: number;
  key: string;
}

function keyFor(rows: readonly FactoryModule[][]): string {
  return JSON.stringify(
    rows.map((row) =>
      row.map((module) => [module.machineCount, Number(module.workload!.toFixed(8))]),
    ),
  );
}

/** Fixed connection costs make a tiny spill expensive too. Degree penalties discourage hubs.
 * This is a topology/footprint proxy; coordinates and concrete corridor routes are still later. */
export function placementPlanScore(
  modules: readonly FactoryModule[],
  flows: ModuleFlowAllocation,
  beltCapacity: number,
): number {
  const degrees = new Map<string, number>();
  let score = modules.length * 3;
  for (const flow of flows.connections) {
    score +=
      10 +
      (flow.resource.startsWith('fluid:') ? 1 : Math.ceil((flow.rate - EPSILON) / beltCapacity));
    for (const [id, side] of [
      [flow.producerId, 'out'],
      [flow.consumerId, 'in'],
    ]) {
      const key = `${id}:${side}:${flow.resource}`;
      degrees.set(key, (degrees.get(key) ?? 0) + 1);
    }
  }
  for (const degree of degrees.values()) score += Math.max(0, degree - 1) * 4;
  for (const flow of [...flows.unmetInputs, ...flows.unusedOutputs]) {
    score +=
      2 +
      (flow.resource.startsWith('fluid:') ? 1 : Math.ceil((flow.rate - EPSILON) / beltCapacity));
  }
  for (const module of modules)
    score += module.size.width * module.size.height * 0.001 + (module.estimated ? 0.1 : 0);
  return score;
}

/** Candidate boundaries are exact consumer demands, producer supplies, and nearby integer work.
 * Pairwise sums discover one supplier dedicated to a neighborhood of several consumers. */
function workloadTargets(recipe: RecipePlacements, modules: readonly FactoryModule[]): number[] {
  const targets = new Set<number>();
  const add = (value: number) => {
    if (value > EPSILON && value < recipe.workload - EPSILON) targets.add(value);
  };
  // Bounded integer seeds include symmetric and asymmetric splits without a combinatorial partition enumeration.
  const stride = Math.max(1, Math.ceil(recipe.installed / 64));
  for (let value = 1; value < recipe.workload; value += stride) add(value);
  add(recipe.workload / 2);
  add(recipe.workload / 3);
  add((recipe.workload * 2) / 3);
  for (const [side, rates] of [
    ['outputs', { ...recipe.problem.outputs.solids, ...recipe.problem.outputs.fluids }],
    ['inputs', { ...recipe.problem.inputs.solids, ...recipe.problem.inputs.fluids }],
  ] as const) {
    for (const [resource, perMachine] of Object.entries(rates)) {
      if (perMachine <= EPSILON) continue;
      const counterpart = side === 'outputs' ? 'inputs' : 'outputs';
      const amounts = modules
        .filter((module) => module.recipe !== recipe.recipe)
        .map((module) => module[counterpart][resource as ResourceId] ?? 0)
        .filter((rate) => rate > EPSILON);
      for (let i = 0; i < amounts.length; i++) {
        add(amounts[i] / perMachine);
        add(recipe.workload - amounts[i] / perMachine);
        for (let j = i + 1; j < Math.min(amounts.length, 16); j++)
          add((amounts[i] + amounts[j]) / perMachine);
      }
    }
  }
  return [...targets].sort((a, b) => a - b);
}

/** Joint bounded beam search: every sizing move is scored with a new sparse flow assignment.
 * Only the whole-cell ceil(workload) buildings can be redistributed; no candidate adds machines. */
export function planCellPlacements(
  demands: readonly PlacementDemand[],
  beltCapacity: number,
  options: PlacementPlanOptions = {},
): PlacementPlan {
  const recipes = placementRecipes(demands, beltCapacity);
  const minimumPlacements = recipes.reduce((sum, recipe) => sum + recipe.minimum, 0);
  const maxPlacements = Math.max(
    minimumPlacements,
    Math.floor(minimumPlacements * (options.maxPlacementMultiplier ?? 2)),
  );
  const maxStates = Math.max(1, options.maxStates ?? 800);
  const beamWidth = Math.max(1, options.beamWidth ?? 8);
  const resources = [
    ...new Set(
      recipes.flatMap(({ problem }) =>
        Object.keys({
          ...problem.inputs.solids,
          ...problem.inputs.fluids,
          ...problem.outputs.solids,
          ...problem.outputs.fluids,
        }),
      ),
    ),
  ] as ResourceId[];
  const seen = new Set<string>();
  const flowCache = new Map<string, ModuleFlowAllocation>();
  let exploredStates = 0;
  const evaluate = (rows: FactoryModule[][]): Candidate => {
    const modules = rows.flat();
    const flows: ModuleFlowAllocation = { connections: [], unmetInputs: [], unusedOutputs: [] };
    for (const resource of resources) {
      const relevant = modules.filter(
        (module) => module.inputs[resource] > EPSILON || module.outputs[resource] > EPSILON,
      );
      const key = JSON.stringify([
        resource,
        relevant.map((module) => [module.id, module.inputs[resource], module.outputs[resource]]),
      ]);
      let allocation = flowCache.get(key);
      if (!allocation) {
        allocation = searchModuleFlows(
          relevant,
          [resource],
          options.flowMaxStates ?? 24,
        ).allocation;
        flowCache.set(key, allocation);
      }
      flows.connections.push(...allocation.connections);
      flows.unmetInputs.push(...allocation.unmetInputs);
      flows.unusedOutputs.push(...allocation.unusedOutputs);
    }
    exploredStates++;
    const key = keyFor(rows);
    seen.add(key);
    return { rows, modules, flows, score: placementPlanScore(modules, flows, beltCapacity), key };
  };
  let best = evaluate(recipes.map((recipe) => partitionWorkloads(recipe, [])!));
  let beam = [best];
  let budget = false;
  while (beam.length) {
    const next: Candidate[] = [];
    for (const current of beam) {
      for (let row = 0; row < recipes.length; row++) {
        const recipe = recipes[row];
        const targets = workloadTargets(recipe, current.modules);
        // Preserve another useful boundary to permit dedicated feeds plus a shared remainder.
        const anchors = [
          [],
          ...current.rows[row].slice(0, 3).map((module) => [module.workload!]),
          // Split the largest remaining block while preserving all smaller dedicated feeds.
          current.rows[row].slice(1).map((module) => module.workload!),
        ];
        for (const target of targets) {
          for (const anchor of anchors) {
            const replacement = partitionWorkloads(recipe, [...anchor, target]);
            if (!replacement) continue;
            const rows = current.rows.map((modules, index) =>
              index === row ? replacement : modules,
            );
            if (
              rows.reduce((sum, modules) => sum + modules.length, 0) > maxPlacements ||
              seen.has(keyFor(rows))
            )
              continue;
            if (exploredStates >= maxStates) {
              budget = true;
              break;
            }
            const candidate = evaluate(rows);
            if (
              candidate.score < best.score - EPSILON ||
              (Math.abs(candidate.score - best.score) <= EPSILON && candidate.key < best.key)
            )
              best = candidate;
            next.push(candidate);
          }
          if (budget) break;
        }
        if (budget) break;
      }
      if (budget) break;
    }
    if (budget) break;
    // Keep ties and modestly worse intermediate moves: improving another recipe may need them.
    beam = next.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key)).slice(0, beamWidth);
  }
  return {
    modules: best.modules,
    flows: best.flows,
    score: best.score,
    diagnostics: {
      exploredStates,
      minimumPlacements,
      maxPlacements,
      stopReason: budget ? 'budget' : 'complete',
      optimal: false,
    },
  };
}
