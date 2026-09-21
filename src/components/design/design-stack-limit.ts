import type { DesignColumn } from '../../compute/design.ts';
import type { KernelProblem, ResourceRates } from '../../compute/kernel-problems.ts';
import type { ResourceId } from '../../types.ts';
import type { DesignSceneRecipes } from './design-scene.tsx';
import { beltInputItemTraces, beltItemLaneCounts, beltItemTraces } from './design-belt-traces.ts';
import { MAX_ASSEMBLER_STACK_HEIGHT } from '../cell/assembler-layout.ts';

/** Maximum copies which fit both the kernel's belt lanes and the brick's physical height. */
export function beltStackLimit(
  column: DesignColumn,
  recipes: DesignSceneRecipes,
  problem: KernelProblem,
  beltItemsPerSecond: number,
): number {
  const inputLanes = beltItemLaneCounts(column, recipes, beltInputItemTraces(column, recipes));
  const outputLanes = beltItemLaneCounts(column, recipes, beltItemTraces(column, recipes, true));
  const laneItemsPerSecond = beltItemsPerSecond / 2;
  const limits = [
    ...sideStackLimits(problem.inputs.solids, inputLanes, laneItemsPerSecond),
    ...sideStackLimits(problem.outputs.solids, outputLanes, laneItemsPerSecond),
  ];
  const beltLimit = limits.length > 0 ? Math.floor(Math.min(...limits)) : Infinity;
  const physicalLimit = physicalStackLimit(column);
  return Math.min(beltLimit, physicalLimit);
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
): number[] {
  return Object.entries(rates).map(([resource, rate]) => {
    const item = resource.startsWith('item:') ? resource : `item:${resource}`;
    const lanes = laneCounts.get(item as ResourceId) ?? 0;
    return (lanes * laneItemsPerSecond) / rate;
  });
}
