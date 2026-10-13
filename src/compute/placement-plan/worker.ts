import loadHighs from 'highs';
import wasmUrl from 'highs/runtime?url';
import { planCellPlacements, baselineCellPlacements, type PlacementPlanOptions } from './index.ts';
import type { PlacementDemand } from './recipes.ts';

export interface PlacementRequest {
  id: number;
  demands: PlacementDemand[];
  beltCapacity: number;
  options?: PlacementPlanOptions;
}
const runtime = loadHighs({ locateFile: () => wasmUrl });
// The worker is dedicated to one active request; cancellation terminates it rather than
// queueing synchronous solver work behind an obsolete model.
globalThis.onmessage = async ({ data }: MessageEvent<PlacementRequest>) => {
  const { id, demands, beltCapacity, options } = data;
  try {
    const plan = planCellPlacements(await runtime, demands, beltCapacity, options);
    globalThis.postMessage({ id, plan });
  } catch (error) {
    const plan = baselineCellPlacements(demands, beltCapacity);
    plan.diagnostics = {
      solver: 'baseline',
      status: 'fallback',
      reason: error instanceof Error ? error.message : String(error),
    };
    globalThis.postMessage({ id, plan });
  }
};
