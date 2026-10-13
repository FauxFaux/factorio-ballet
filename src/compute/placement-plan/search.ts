import type { FactoryModule } from '../modules.ts';
import type { ModuleFlowAllocation } from '../module-connections.ts';
import type { ResourceId } from '../../types.ts';
import { searchModuleFlows } from './flow-search.ts';
import { EPSILON, placementRecipes, type PlacementDemand } from './recipes.ts';
import { recipeCandidates } from './candidates.ts';

export interface PlacementPlanOptions {
  maxPlacementMultiplier?: number;
  /** Complete combinations evaluated; the default permits a million. */
  maxStates?: number;
  /** Includes fractional workload alternatives as well as physical splits. */
  maxCandidatesPerRecipe?: number;
  flowMaxStates?: number;
}
export interface PlacementPlan {
  modules: FactoryModule[];
  flows: ModuleFlowAllocation;
  score: number;
  diagnostics: {
    exploredStates: number;
    candidateCombinations: number;
    candidatesPerRecipe: number[];
    materialEvaluations: number;
    prunedCombinations: number;
    minimumPlacements: number;
    maxPlacements: number;
    stopReason: 'complete' | 'budget';
    /** The candidate family and bounded support search do not prove a global optimum. */
    optimal: false;
  };
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

interface MaterialFactor {
  resource: ResourceId;
  rows: number[];
  strides: number[];
  scores: Map<number, number>;
}

/** Enumerate whole-cell combinations of independent shortlists. The score separates by material,
 * so unchanged material networks are evaluated once, not once per full-cell combination.
 * Ports/geometry are built once per recipe candidate; only winning flows are retained. */
export function searchCellPlacements(
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
  const maxStates = Math.max(1, Math.floor(options.maxStates ?? 1_000_000));
  const limit = Math.max(1, Math.floor(options.maxCandidatesPerRecipe ?? 6));
  const candidates = recipes.map((recipe) =>
    recipeCandidates(recipe, recipes, limit, maxPlacements - minimumPlacements + recipe.minimum),
  );
  const choices = recipes.map(() => 0);
  const rowCosts = candidates.map((row) =>
    row.map((modules) =>
      placementPlanScore(
        modules,
        { connections: [], unmetInputs: [], unusedOutputs: [] },
        beltCapacity,
      ),
    ),
  );
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
  ].sort() as ResourceId[];
  const factors: MaterialFactor[] = resources.flatMap((resource) => {
    const producerRows = candidates.flatMap((row, index) =>
      row.some((modules) => modules.some((module) => module.outputs[resource] > EPSILON))
        ? [index]
        : [],
    );
    const consumerRows = candidates.flatMap((row, index) =>
      row.some((modules) => modules.some((module) => module.inputs[resource] > EPSILON))
        ? [index]
        : [],
    );
    const rows = [...new Set([...producerRows, ...consumerRows])].sort((a, b) => a - b);
    // Pure imports/exports have no internal allocation decisions. Their branch costs are
    // independent per recipe; making one ten-recipe factor would destroy cache reuse.
    const groups = producerRows.length && consumerRows.length ? [rows] : rows.map((row) => [row]);
    return groups.map((rows) => {
      let stride = 1;
      const strides = rows.map((row) => {
        const value = stride;
        stride *= candidates[row].length;
        return value;
      });
      return { resource, rows, strides, scores: new Map<number, number>() };
    });
  });
  let materialEvaluations = 0;
  const factorScore = (factor: MaterialFactor): number => {
    let key = 0;
    for (let i = 0; i < factor.rows.length; i++) key += choices[factor.rows[i]] * factor.strides[i];
    const cached = factor.scores.get(key);
    if (cached !== undefined) return cached;
    const modules = factor.rows.flatMap((row) => candidates[row][choices[row]]);
    const flows = searchModuleFlows(
      modules,
      [factor.resource],
      options.flowMaxStates ?? 24,
    ).allocation;
    const score = placementPlanScore([], flows, beltCapacity);
    factor.scores.set(key, score);
    materialEvaluations++;
    return score;
  };
  const empty: ModuleFlowAllocation = { connections: [], unmetInputs: [], unusedOutputs: [] };
  let bestScore =
    rowCosts.reduce((sum, row) => sum + row[0], 0) +
    factors.reduce((sum, factor) => sum + factorScore(factor), 0);
  let bestChoices = [...choices];
  let exploredStates = 1;
  let prunedCombinations = 0;
  let budget = false;
  const suffixCombinations = new Float64Array(recipes.length + 1);
  const suffixCost = new Float64Array(recipes.length + 1);
  const suffixPlacements = new Int32Array(recipes.length + 1);
  suffixCombinations[recipes.length] = 1;
  for (let row = recipes.length - 1; row >= 0; row--) {
    suffixCombinations[row] = suffixCombinations[row + 1] * candidates[row].length;
    suffixCost[row] = suffixCost[row + 1] + Math.min(...rowCosts[row]);
    suffixPlacements[row] =
      suffixPlacements[row + 1] + Math.min(...candidates[row].map((modules) => modules.length));
  }
  const completedFactors = recipes.map((_, row) =>
    factors.filter((factor) => factor.rows.at(-1) === row),
  );
  const suffixMaterialMinimum = new Float64Array(recipes.length + 1);
  // Small networks are cheap to tabulate completely. Their exact minimum is a useful
  // lower bound even while their recipes remain unselected; wide networks use zero.
  for (const factor of factors) {
    let minimum = 0;
    const combinations = factor.rows.reduce((product, row) => product * candidates[row].length, 1);
    if (factor.rows.length <= 2 && combinations <= 256) {
      minimum = Infinity;
      const enumerate = (position: number) => {
        if (position === factor.rows.length) {
          minimum = Math.min(minimum, factorScore(factor));
          return;
        }
        const row = factor.rows[position];
        for (let choice = 0; choice < candidates[row].length; choice++) {
          choices[row] = choice;
          enumerate(position + 1);
        }
        choices[row] = 0;
      };
      enumerate(0);
    }
    suffixMaterialMinimum[factor.rows.at(-1)!] += minimum;
  }
  for (let row = recipes.length - 1; row >= 0; row--)
    suffixMaterialMinimum[row] += suffixMaterialMinimum[row + 1];
  const visit = (row: number, placements: number, score: number) => {
    if (row === recipes.length) {
      if (choices.every((choice) => choice === 0)) return;
      if (exploredStates >= maxStates) {
        budget = true;
        return;
      }
      exploredStates++;
      if (score < bestScore - EPSILON) {
        bestScore = score;
        bestChoices = [...choices];
      }
      return;
    }
    for (let choice = 0; choice < candidates[row].length; choice++) {
      choices[row] = choice;
      if (
        row === recipes.length - 1 &&
        exploredStates >= maxStates &&
        !choices.every((value) => value === 0)
      ) {
        budget = true;
        return;
      }
      const count = placements + candidates[row][choice].length;
      if (count + suffixPlacements[row + 1] > maxPlacements) {
        prunedCombinations += suffixCombinations[row + 1];
        continue;
      }
      let next = score + rowCosts[row][choice];
      for (const factor of completedFactors[row]) next += factorScore(factor);
      // Remaining material costs are nonnegative, so this is an admissible lower bound.
      if (
        row < recipes.length - 1 &&
        next + suffixCost[row + 1] + suffixMaterialMinimum[row + 1] > bestScore + EPSILON
      ) {
        prunedCombinations += suffixCombinations[row + 1];
        continue;
      }
      visit(row + 1, count, next);
      if (budget) return;
    }
  };
  visit(0, 0, 0);
  const modules = candidates.flatMap((row, index) => row[bestChoices[index]]);
  const flows = modules.length
    ? searchModuleFlows(modules, resources, options.flowMaxStates ?? 24).allocation
    : empty;
  return {
    modules,
    flows,
    score: bestScore,
    diagnostics: {
      exploredStates,
      candidateCombinations: suffixCombinations[0],
      candidatesPerRecipe: candidates.map((row) => row.length),
      materialEvaluations,
      prunedCombinations,
      minimumPlacements,
      maxPlacements,
      stopReason: budget ? 'budget' : 'complete',
      optimal: false,
    },
  };
}
