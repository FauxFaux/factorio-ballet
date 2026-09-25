import type { DesignColumn } from '../../compute/design.ts';
import type { KernelProblem, ResourceRates } from '../../compute/kernel-problems.ts';
import type { ResourceId } from '../../types.ts';
import type { DesignSceneRecipes } from './design-scene.tsx';
import { beltInputItemTraces, beltItemLaneCounts, beltItemTraces } from './design-belt-traces.ts';
import { MAX_ASSEMBLER_STACK_HEIGHT } from '../radar/radar-assembler-layout.ts';

/** Maximum copies which fit both the kernel's belt lanes and the brick's physical height. */
export function beltStackLimit(
  column: DesignColumn,
  recipes: DesignSceneRecipes,
  problem: KernelProblem,
  beltItemsPerSecond: number,
): number {
  return beltStackLimitDetails(column, recipes, problem, beltItemsPerSecond).limit;
}

export interface BeltStackLimitDetails {
  limit: number;
  reason:
    | { kind: 'belt'; resource: ResourceId; rate: number; lanes: number }
    | { kind: 'physical'; columnHeight: number; districtHeight: number };
}

/** Returns the limiting belt resource and rate, or the physical column-height cap. */
export function beltStackLimitDetails(
  column: DesignColumn,
  recipes: DesignSceneRecipes,
  problem: KernelProblem,
  beltItemsPerSecond: number,
): BeltStackLimitDetails {
  const inputLanes = beltItemLaneCounts(column, recipes, beltInputItemTraces(column, recipes));
  const outputLanes = beltItemLaneCounts(column, recipes, beltItemTraces(column, recipes, true));
  const laneItemsPerSecond = beltItemsPerSecond / 2;
  const limits = [
    ...sideStackLimits(problem.inputs.solids, inputLanes, laneItemsPerSecond),
    ...sideStackLimits(problem.outputs.solids, outputLanes, laneItemsPerSecond),
  ];
  const beltLimiter = limits.toSorted((left, right) => left.copies - right.copies)[0];
  const beltLimit = beltLimiter ? Math.floor(beltLimiter.copies) : Infinity;
  const physicalLimit = physicalStackLimit(column);
  if (physicalLimit <= beltLimit) {
    const height = columnHeight(column);
    return {
      limit: physicalLimit,
      reason: {
        kind: 'physical',
        columnHeight: height,
        districtHeight: MAX_ASSEMBLER_STACK_HEIGHT,
      },
    };
  }
  return {
    limit: beltLimit,
    reason: beltLimiter
      ? {
          kind: 'belt',
          resource: beltLimiter.resource as ResourceId,
          rate: beltLimiter.rate,
          lanes: beltLimiter.lanes,
        }
      : {
          kind: 'physical',
          columnHeight: columnHeight(column),
          districtHeight: MAX_ASSEMBLER_STACK_HEIGHT,
        },
  };
}

/** Copies of a kernel which fit in the brick's 100-tile assembler district. */
export function physicalStackLimit(column: DesignColumn): number {
  return Math.floor(MAX_ASSEMBLER_STACK_HEIGHT / columnHeight(column));
}

function columnHeight(column: DesignColumn): number {
  const minY = Math.min(...column.entities.map(({ position }) => position.y));
  const maxY = Math.max(
    ...column.entities.map(
      (entity) => entity.position.y + (entity.kind === 'assembler' ? entity.size.height : 1),
    ),
  );
  return maxY - minY;
}

function sideStackLimits(
  rates: ResourceRates,
  laneCounts: ReadonlyMap<ResourceId, number>,
  laneItemsPerSecond: number,
): { copies: number; resource: string; rate: number; lanes: number }[] {
  return Object.entries(rates).map(([resource, rate]) => {
    const item = resource.startsWith('item:') ? resource : `item:${resource}`;
    const lanes = laneCounts.get(item as ResourceId) ?? 0;
    return { copies: (lanes * laneItemsPerSecond) / rate, resource: item, rate, lanes };
  });
}
