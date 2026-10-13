import {
  estimatedModulesForRecipe,
  MAX_MODULE_HEIGHT,
  moduleForTile,
  withModuleWorkload,
  type FactoryModule,
} from '../modules.ts';
import type { KernelLayoutOption } from '../kernel-layout-options.ts';
import type { KernelProblem } from '../kernel-problems.ts';

export const EPSILON = 1e-8;
export interface PlacementDemand {
  problem: KernelProblem;
  options: readonly KernelLayoutOption[];
  machineCount: number | undefined;
}
export interface RecipePlacements {
  recipe: string;
  workload: number;
  installed: number;
  problem: KernelProblem;
  minimum: number;
  /** Supported exact integer capacities, including explicitly estimated remainders. */
  templates: readonly FactoryModule[];
  /** Cheapest supported physical partition for each integer building total. */
  partition: (installed: number) => number[] | undefined;
  build: (installed: number, workload: number, index: number) => FactoryModule | undefined;
}

/** Retain all validated families, and never round a recipe up again when splitting it. */
export function placementRecipes(
  demands: readonly PlacementDemand[],
  beltCapacity: number,
  extraBuildings = 0,
): RecipePlacements[] {
  return demands
    .flatMap(({ problem, options: suppliedOptions, machineCount }) => {
      if (machineCount === undefined || !Number.isFinite(machineCount) || machineCount <= 0)
        return [];
      const recipe = problem.assemblers[0]?.name ?? '';
      const options = suppliedOptions.filter((option) => option.result.validation.valid);
      const installed = Math.max(1, Math.ceil(machineCount - EPSILON));
      const templates = new Map<number, FactoryModule>();
      const estimate = estimatedModulesForRecipe(recipe, installed, problem, beltCapacity);
      const estimateLimit = estimate[0]?.machineCount ?? 1;
      // A pair-only family cannot represent an odd remainder without adding a building.
      // Such a remainder stays explicitly estimated until a single-machine kernel exists.
      const fallbackLimit = options.length ? 1 : estimateLimit;
      const maximum = Math.min(
        installed + extraBuildings,
        Math.max(fallbackLimit, ...options.map((option) => option.maxBuildingsPerColumn)),
      );
      for (let count = 1; count <= maximum; count++) {
        const candidates = options.flatMap((option) => {
          const step = option.buildingsPerRepeat;
          const capacity = Math.min(
            option.maxBuildingsPerColumn,
            option.result.validation.supportedCopies * step,
            Math.floor(MAX_MODULE_HEIGHT / option.result.candidate.pitch) * step,
          );
          return step > 0 && count % step === 0 && count <= capacity
            ? [moduleForTile(recipe, count / step, problem, option.result.candidate, '')]
            : [];
        });
        candidates.sort(
          (a, b) =>
            a.size.width * a.size.height - b.size.width * b.size.height ||
            a.ports.length - b.ports.length,
        );
        const template =
          candidates[0] ??
          (count <= fallbackLimit
            ? estimatedModulesForRecipe(recipe, count, problem, beltCapacity)[0]
            : undefined);
        if (template) templates.set(count, template);
      }
      const costs = new Float64Array(installed + 1).fill(Infinity);
      const previous = new Int32Array(installed + 1);
      const lengths = new Int32Array(installed + 1);
      costs[0] = 0;
      for (let total = 1; total <= installed; total++) {
        for (const [count, template] of templates) {
          if (count > total) continue;
          const cost =
            costs[total - count] +
            1e6 +
            (template.estimated && options.length ? 1e5 : 0) +
            template.size.width * template.size.height;
          if (cost < costs[total] || (cost === costs[total] && count > previous[total])) {
            costs[total] = cost;
            previous[total] = count;
            lengths[total] = lengths[total - count] + 1;
          }
        }
      }
      const partition = (total: number): number[] | undefined => {
        if (!Number.isFinite(costs[total])) return undefined;
        const counts: number[] = [];
        while (total > 0) {
          const count = previous[total];
          counts.push(count);
          total -= count;
        }
        return counts.sort((a, b) => b - a);
      };
      return [
        {
          recipe,
          workload: machineCount,
          installed,
          problem,
          minimum: lengths[installed],
          templates: [...templates.values()],
          partition,
          build: (count: number, workload: number, index: number) => {
            const template = templates.get(count);
            return template
              ? { ...withModuleWorkload(template, workload), id: `${recipe}:${index}` }
              : undefined;
          },
        },
      ];
    })
    .sort((a, b) => a.recipe.localeCompare(b.recipe));
}

/** Commit selected fractional work boundaries, then pack the remaining installed capacity. */
export function partitionWorkloads(
  recipe: RecipePlacements,
  targets: readonly number[],
): FactoryModule[] | undefined {
  let buildings = recipe.installed;
  let remaining = recipe.workload;
  const pieces: { count: number; work: number }[] = [];
  for (const target of targets) {
    if (target <= EPSILON || target >= remaining - EPSILON) return undefined;
    let count = Math.ceil(target - EPSILON);
    while (count <= buildings && !recipe.build(count, target, 0)) count++;
    if (count >= buildings || buildings - count < Math.ceil(remaining - target - EPSILON))
      return undefined;
    pieces.push({ count, work: target });
    buildings -= count;
    remaining -= target;
  }
  const tail = recipe.partition(buildings);
  if (!tail) return undefined;
  // Spread unused capacity proportionally in the uncommitted tail. Committed matches stay exact.
  for (const count of tail) pieces.push({ count, work: (remaining * count) / buildings });
  pieces.sort((a, b) => b.work - a.work || b.count - a.count);
  return pieces.map(({ count, work }, index) => recipe.build(count, work, index)!);
}
