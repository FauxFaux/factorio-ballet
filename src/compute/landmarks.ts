import type { ResourceId } from '../types.ts';

/** ~16px of icon on a ~400px track; any closer and two landmarks overlap instead of reading. */
const MIN_PACK_GAP = 0.04;

/** A science pack and where on the complexity scale it sits: one mark on the progress slider. */
export interface Landmark {
  id: ResourceId;
  complexity: number;
}

/** Thin science packs into the non-overlapping landmarks shown on the progress slider. */
export function selectPackLandmarks(
  sciencePacks: ResourceId[],
  resources: Record<string, { complexity?: number }>,
): Landmark[] {
  const out: Landmark[] = [];
  for (const id of sciencePacks) {
    const complexity = resources[id]?.complexity;
    if (complexity === undefined) continue;
    const last = out[out.length - 1];
    if (last && complexity - last.complexity < MIN_PACK_GAP) continue;
    out.push({ id, complexity });
  }
  return out;
}
