import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  baselineCellPlacements,
  type PlacementPlan,
  type PlacementPlanOptions,
} from '../../compute/placement-plan/index.ts';
import type { PlacementDemand } from '../../compute/placement-plan/recipes.ts';

/** Cache completed plans by value. Changes cancel old work and cannot publish a stale plan. */
export function useCellPlacementPlan(
  demands: readonly (PlacementDemand & { pending?: boolean })[],
  enabled: boolean,
  beltCapacity: number,
  boundary: NonNullable<PlacementPlanOptions['boundary']>,
) {
  const pending = demands.some((demand) => demand.pending);
  const key = JSON.stringify([
    enabled,
    beltCapacity,
    boundary,
    demands.map(({ problem, machineCount, options }) => ({ problem, machineCount, options })),
  ]);
  const cache = useRef(new Map<string, PlacementPlan>());
  const [answer, setAnswer] = useState<{ key: string; plan: PlacementPlan }>();
  const initial = useMemo(
    () => baselineCellPlacements(enabled ? demands : [], beltCapacity),
    [key],
  );
  useEffect(() => {
    if (!enabled || pending || !demands.length) return;
    const cached = cache.current.get(key);
    if (cached) {
      setAnswer({ key, plan: cached });
      return;
    }
    let worker: Worker;
    try {
      if (typeof Worker === 'undefined') throw new Error('Placement workers are unavailable');
      worker = new Worker(new URL('../../compute/placement-plan/worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      setAnswer({
        key,
        plan: {
          ...initial,
          diagnostics: {
            solver: 'baseline',
            status: 'fallback',
            reason: error instanceof Error ? error.message : String(error),
          },
        },
      });
      return;
    }
    let cancelled = false;
    worker.onmessage = ({ data }: MessageEvent<{ id: number; plan: PlacementPlan }>) => {
      if (cancelled || data.id !== 1) return;
      cache.current.set(key, data.plan);
      if (cache.current.size > 16) cache.current.delete(cache.current.keys().next().value!);
      setAnswer({ key, plan: data.plan });
      worker.terminate();
    };
    worker.onerror = () => {
      if (!cancelled)
        setAnswer({
          key,
          plan: {
            ...initial,
            diagnostics: {
              solver: 'baseline',
              status: 'fallback',
              reason: 'Placement worker failed',
            },
          },
        });
      worker.terminate();
    };
    worker.postMessage({
      id: 1,
      demands: demands.map(({ problem, machineCount, options }) => ({
        problem,
        machineCount,
        options,
      })),
      beltCapacity,
      options: { boundary },
    });
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [key, pending]);
  return answer?.key === key ? answer.plan : (cache.current.get(key) ?? initial);
}
