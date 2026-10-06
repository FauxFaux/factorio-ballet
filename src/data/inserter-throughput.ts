import type { Belt, Inserter, InserterCapacityBonus } from '../types.ts';
import { defaultBelt } from './index.ts';
import type { Dataset } from '../dataset/index.ts';
import type { InserterPerformance, ThroughputGrid } from './inserter-performance.ts';

/**
 * Estimate one inserter's dependable belt transfer rate at a point in game progress.
 *
 * The result is the lower of chest-to-belt and perpendicular belt-to-chest throughput, because a
 * planner generally does not yet know which side of a machine the belt will be on. Wiki data is
 * interpolated between measured rotation speeds, hand capacities and belt tiers. Values beyond
 * the measured vanilla ranges are linear extrapolations and therefore intentionally estimates.
 * One inserter only serves one lane, so extrapolation is capped at half the belt's full throughput.
 * Reach is measured relative to a normal inserter and is assumed to reduce throughput linearly: a
 * reach-two long-handed inserter takes twice as long to move its hand and therefore transfers half
 * as many items.
 */
export function inserterItemsPerSecond(
  performance: InserterPerformance,
  inserter: Inserter,
  inserterCapacityBonus: InserterCapacityBonus | undefined,
  belt: Belt,
  reach = 1,
): number {
  const capacity = inserterCapacity(inserter, inserterCapacityBonus);
  const chestToBelt = inserter.bulk
    ? bulkRate(
        performance.bulkChestToBelt,
        inserter.rotationSpeed / performance.bulkRotationSpeed,
        capacity,
        belt.itemsPerSecond,
      )
    : gridRate(performance.chestToBelt, inserter.rotationSpeed, capacity, belt.itemsPerSecond);
  const beltToChest = inserter.bulk
    ? bulkRate(
        performance.bulkBeltToChest,
        inserter.rotationSpeed / performance.bulkRotationSpeed,
        capacity,
        belt.itemsPerSecond,
      )
    : gridRate(performance.beltToChest, inserter.rotationSpeed, capacity, belt.itemsPerSecond);

  return Math.min(chestToBelt, beltToChest, belt.itemsPerSecond / 2) / reach;
}

/**
 * Estimate the best inserter-to-belt transfer available at this point in the game. The belt and
 * latest capacity research come from the same progress scale; the inserter is whichever unlocked
 * non-stack prototype produces the highest estimate.
 */
export function inserterItemsPerSecondAtProgress(ds: Dataset, progress: number, reach = 1): number {
  return inserterItemsPerSecondForBeltAtProgress(
    ds,
    progress,
    defaultBelt(ds, progress).belt,
    reach,
  );
}

/** Estimate the best unlocked inserter's transfer rate against a caller-selected belt. */
export function inserterItemsPerSecondForBeltAtProgress(
  ds: Dataset,
  progress: number,
  belt: Belt,
  reach = 1,
): number {
  const { data, inserterPerformance } = ds;
  const capacityBonus = data.inserterCapacityBonuses.findLast(
    ([complexity]) => complexity <= progress,
  );
  const rates = Object.values(data.inserters)
    .filter(
      (inserter) =>
        !isStackInserter(inserter) &&
        (data.resources[`item:${inserter.item}`]?.complexity ?? Infinity) <= progress,
    )
    .map((inserter) =>
      inserterItemsPerSecond(inserterPerformance, inserter, capacityBonus, belt, reach),
    );

  return Math.max(...rates);
}

function inserterCapacity(
  inserter: Inserter,
  researched: InserterCapacityBonus | undefined,
): number {
  if (!researched) return inserter.baseStackSize;
  if (inserter.bulk) return inserter.baseStackSize + researched[2];
  if (inserter.usesInserterStackSizeBonus === false) return inserter.baseStackSize;
  return inserter.baseStackSize + researched[1];
}

function isStackInserter(inserter: Inserter): boolean {
  return (
    inserter.maxBeltStackSize !== undefined ||
    inserter.grabLessToMatchBeltStack === true ||
    inserter.waitForFullHand === true
  );
}

function bulkRate(
  capacities: ThroughputGrid[number]['capacities'],
  relativeRotationSpeed: number,
  capacity: number,
  beltSpeed: number,
): number {
  return capacityRate(capacities, capacity, beltSpeed) * relativeRotationSpeed;
}

function gridRate(
  grid: ThroughputGrid,
  rotationSpeed: number,
  capacity: number,
  beltSpeed: number,
): number {
  return interpolate(
    grid.map(({ rotationSpeed, capacities }) => [
      rotationSpeed,
      capacityRate(capacities, capacity, beltSpeed),
    ]),
    rotationSpeed,
  );
}

function capacityRate(
  capacities: ThroughputGrid[number]['capacities'],
  capacity: number,
  beltSpeed: number,
): number {
  return interpolate(
    capacities.map((row) => [row.capacity, interpolate(row.byBeltSpeed, beltSpeed)]),
    capacity,
  );
}

/** Piecewise-linear interpolation, extending the nearest segment outside the measured range. */
function interpolate(points: ReadonlyArray<readonly [number, number]>, value: number): number {
  const upperIndex = points.findIndex(([x]) => x >= value);
  const right = upperIndex === -1 ? points.length - 1 : Math.max(1, upperIndex);
  const [x1, y1] = points[right - 1];
  const [x2, y2] = points[right];
  return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1);
}
