import { isFluid, type Machine, type ResourceId } from '../types.ts';

export interface FluidBoxResource {
  resource: ResourceId;
  fluidboxIndex?: number;
}

/**
 * Match recipe fluids to the machine's ordered, side-specific fluid-box indexes.
 *
 * Factorio merges unindexed boxes into contiguous groups. Divide the remaining boxes as evenly as
 * possible between the remaining fluids, giving an indivisible extra box to the earlier fluid.
 * See docs/FLUIDBOXES.md.
 */
export function fluidBoxResources(
  machine: Pick<Machine, 'fluidBoxes'>,
  recipe: { ingredients: FluidBoxResource[]; products: FluidBoxResource[] } | undefined,
): ReadonlyMap<number, ResourceId> {
  const result = new Map<number, ResourceId>();
  if (!machine.fluidBoxes || !recipe) return result;

  const assign = (
    side: 'input' | 'output',
    fluids: Array<{ resource: ResourceId; fluidboxIndex?: number }>,
  ) => {
    const boxes = machine.fluidBoxes!.flatMap((box, index) =>
      box.productionType === side || box.productionType === 'input-output' ? [index] : [],
    );
    const fluidResources = fluids.filter(({ resource }) => isFluid(resource));
    for (const fluid of fluidResources) {
      if (!fluid.fluidboxIndex) continue;
      const boxIndex = boxes[fluid.fluidboxIndex - 1];
      if (boxIndex !== undefined) result.set(boxIndex, fluid.resource);
    }
    const unclaimed = boxes.filter((boxIndex) => !result.has(boxIndex));
    const unindexed = fluidResources.filter(({ fluidboxIndex }) => !fluidboxIndex);
    for (const [fluidIndex, fluid] of unindexed.entries()) {
      const remainingFluids = unindexed.length - fluidIndex;
      const boxCount = Math.ceil(unclaimed.length / remainingFluids);
      for (const boxIndex of unclaimed.splice(0, boxCount)) {
        result.set(boxIndex, fluid.resource);
      }
    }
  };

  assign('input', recipe.ingredients);
  assign('output', recipe.products);
  return result;
}
