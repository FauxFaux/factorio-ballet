import { useEffect, useMemo, useReducer } from 'preact/hooks';
import type { Belt, MachineId, ResourceId } from '../../types.ts';
import { recipeKernelProblem } from '../../compute/modules.ts';
import { allocateKernelLayouts } from '../../compute/kernel-layout-options.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../../data/inserter-throughput.ts';
import type { Dataset } from '../../dataset/index.ts';
import { LayoutCache, layoutRequestKey, type LayoutRequest } from '../../dataset/layout-cache.ts';
import { entryMachine, type CellEntry } from '../../cell.ts';
import type { Solution } from '../../solve/index.ts';

const caches = new WeakMap<Dataset, LayoutCache>();

function cacheFor(ds: Dataset): LayoutCache {
  let cache = caches.get(ds);
  if (!cache) {
    cache = new LayoutCache();
    caches.set(ds, cache);
  }
  return cache;
}

export function recipeLayoutRequest(
  ds: Dataset,
  recipe: string,
  machine: MachineId | undefined,
  inputRates: Map<ResourceId, number> | undefined,
  outputRates: Map<ResourceId, number> | undefined,
  belt: Belt,
  progress: number,
): LayoutRequest {
  return {
    problem: recipeKernelProblem(
      ds.data,
      recipe,
      machine,
      inputRates ?? new Map(),
      outputRates ?? new Map(),
    ),
    throughput: {
      beltItemsPerSecond: belt.itemsPerSecond,
      inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, progress, belt),
      longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(ds, progress, belt, 2),
    },
    undergroundBeltReach: belt.undergroundLength - 1,
  };
}

interface RecipeLayoutDemand {
  request: LayoutRequest;
  machineCount: number | undefined;
}

/** Subscribe by value, so count edits and equivalent solved rates never restart a search. */
function useLayoutAnswers(ds: Dataset, demands: RecipeLayoutDemand[]) {
  const cache = cacheFor(ds);
  const keys = demands.map(({ request, machineCount }) =>
    machineCount !== undefined && machineCount > 0 && Number.isFinite(machineCount)
      ? layoutRequestKey(request)
      : undefined,
  );
  const subscriptions = JSON.stringify(keys);
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const unique = new Map<string, LayoutRequest>();
    keys.forEach((key, index) => {
      if (key !== undefined) unique.set(key, demands[index].request);
    });
    const unsubscribe = [...unique].map(([key, request]) =>
      cache.subscribe(key, request, () => refresh(undefined)),
    );
    // A different consumer may have completed a search between render and subscription.
    refresh(undefined);
    return () => unsubscribe.forEach((stop) => stop());
    // Requests are represented by their canonical keys, rather than object identity.
  }, [cache, subscriptions]);

  return useMemo(
    () =>
      demands.map(({ request, machineCount }, index) => {
        const key = keys[index];
        const state = key === undefined ? undefined : cache.read(key);
        const allocated = allocateKernelLayouts(
          request.problem,
          state?.status === 'ready'
            ? state.result
            : { options: [], reason: state?.status === 'error' ? state.reason : 'no solution' },
          machineCount ?? 0,
        );
        return {
          problem: request.problem,
          machineCount,
          pending: key !== undefined && (!state || state.status === 'pending'),
          ...allocated,
        };
      }),
    [cache, demands, subscriptions, revision],
  );
}

export type RecipeLayoutAnswer = ReturnType<typeof useLayoutAnswers>[number];

export function useRecipeLayouts(
  ds: Dataset,
  recipe: string,
  machine: MachineId | undefined,
  inputRates: Map<ResourceId, number> | undefined,
  outputRates: Map<ResourceId, number> | undefined,
  machineCount: number | undefined,
  belt: Belt,
  progress: number,
) {
  const demands = useMemo(
    () => [
      {
        request: recipeLayoutRequest(ds, recipe, machine, inputRates, outputRates, belt, progress),
        machineCount,
      },
    ],
    [ds, recipe, machine, inputRates, outputRates, machineCount, belt, progress],
  );
  return useLayoutAnswers(ds, demands)[0];
}

/** Warm all solved rows, regardless of whether their connections or physical layout are open. */
export function useCellLayouts(
  ds: Dataset,
  entries: CellEntry[],
  solution: Solution,
  belt: Belt,
  progress: number,
) {
  const demands = useMemo(
    () =>
      entries.map((entry, index) => {
        const recipe = ds.data.recipes[entry.recipe];
        return {
          request: recipeLayoutRequest(
            ds,
            entry.recipe,
            recipe ? entryMachine(entry, recipe, progress, ds) : undefined,
            solution.inputRates[index],
            solution.outputRates[index],
            belt,
            progress,
          ),
          machineCount: solution.counts[index],
        };
      }),
    [ds, entries, solution, belt, progress],
  );
  return useLayoutAnswers(ds, demands);
}
