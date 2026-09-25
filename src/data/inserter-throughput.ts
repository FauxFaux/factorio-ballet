import type { Belt, Inserter, InserterCapacityBonus, StaticData } from '../types.ts';
import { defaultBelt } from './index.ts';

type ThroughputGrid = ReadonlyArray<{
  rotationSpeed: number;
  capacities: ReadonlyArray<{
    capacity: number;
    byBeltSpeed: ReadonlyArray<readonly [number, number]>;
  }>;
}>;

/**
 * Base-quality measurements from the Factorio wiki's "Chest to belt" table. Stack inserters and
 * the transport-belt-stacking research column are deliberately absent.
 */
const CHEST_TO_BELT: ThroughputGrid = [
  {
    rotationSpeed: 0.013,
    capacities: capacities([
      [1, 0.78, 0.78, 0.78, 0.78],
      [2, 1.57, 1.57, 1.57, 1.57],
      [3, 2.15, 2.25, 2.3, 2.3],
    ]),
  },
  {
    rotationSpeed: 0.014,
    capacities: capacities([
      [1, 0.85, 0.85, 0.85, 0.85],
      [2, 1.7, 1.7, 1.7, 1.7],
      [3, 2.3, 2.45, 2.5, 2.5],
    ]),
  },
  {
    rotationSpeed: 0.02,
    capacities: capacities([
      [1, 1.2, 1.2, 1.2, 1.2],
      [2, 2.33, 2.33, 2.33, 2.33],
      [3, 3.1, 3.35, 3.45, 3.45],
    ]),
  },
  {
    rotationSpeed: 0.04,
    capacities: capacities([
      [1, 2.5, 2.5, 2.5, 2.5],
      [2, 4.8, 4.8, 4.8, 4.8],
      [3, 5.62, 6.42, 6.9, 6.9],
    ]),
  },
];

/** Base-quality measurements from "Belt to chest (perpendicular)", with items at belt speed. */
const BELT_TO_CHEST: ThroughputGrid = [
  {
    rotationSpeed: 0.013,
    capacities: capacities([
      [1, 0.6, 0.65, 0.5],
      [2, 1.11, 1.2, 1.13],
      [3, 1.61, 1.61, 1.65],
    ]),
  },
  {
    rotationSpeed: 0.014,
    capacities: capacities([
      [1, 0.94, 0.94, 0.94],
      [2, 1.67, 1.67, 1.5],
      [3, 2.5, 2.25, 2.33],
    ]),
  },
  {
    rotationSpeed: 0.02,
    capacities: capacities([
      [1, 1.18, 1.18, 1.25],
      [2, 2.2, 2.31, 2.4],
      [3, 3.21, 3.21, 3.46],
    ]),
  },
  {
    rotationSpeed: 0.04,
    capacities: capacities([
      [1, 2.5, 2.31, 2.5],
      [2, 4.5, 4.29, 5],
      [3, 6.43, 6, 6.43],
    ]),
  },
];

const BULK_CHEST_TO_BELT = capacities([
  [2, 4.8, 4.8, 4.8, 4.8],
  [4, 6, 7.5, 8.27, 8.58],
  [12, 6.93, 11.23, 14.4, 16.4],
]);

const BULK_BELT_TO_CHEST = capacities([
  [2, 4.5, 4.29, 5],
  [4, 7.5, 7.5, 8],
  [12, 7.5, 11.25, 15],
]);

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
  inserter: Inserter,
  inserterCapacityBonus: InserterCapacityBonus | undefined,
  belt: Belt,
  reach = 1,
): number {
  const capacity = inserterCapacity(inserter, inserterCapacityBonus);
  const chestToBelt = inserter.bulk
    ? bulkRate(BULK_CHEST_TO_BELT, inserter.rotationSpeed, capacity, belt.itemsPerSecond)
    : gridRate(CHEST_TO_BELT, inserter.rotationSpeed, capacity, belt.itemsPerSecond);
  const beltToChest = inserter.bulk
    ? bulkRate(BULK_BELT_TO_CHEST, inserter.rotationSpeed, capacity, belt.itemsPerSecond)
    : gridRate(BELT_TO_CHEST, inserter.rotationSpeed, capacity, belt.itemsPerSecond);

  return Math.min(chestToBelt, beltToChest, belt.itemsPerSecond / 2) / reach;
}

/**
 * Estimate the best inserter-to-belt transfer available at this point in the game. The belt and
 * latest capacity research come from the same progress scale; the inserter is whichever unlocked
 * non-stack prototype produces the highest estimate.
 */
export function inserterItemsPerSecondAtProgress(
  data: StaticData,
  progress: number,
  reach = 1,
): number {
  return inserterItemsPerSecondForBeltAtProgress(data, progress, defaultBelt(progress).belt, reach);
}

/** Estimate the best unlocked inserter's transfer rate against a caller-selected belt. */
export function inserterItemsPerSecondForBeltAtProgress(
  data: StaticData,
  progress: number,
  belt: Belt,
  reach = 1,
): number {
  const capacityBonus = data.inserterCapacityBonuses.findLast(
    ([complexity]) => complexity <= progress,
  );
  const rates = Object.values(data.inserters)
    .filter(
      (inserter) =>
        !isStackInserter(inserter) &&
        (data.resources[`item:${inserter.item}`]?.complexity ?? Infinity) <= progress,
    )
    .map((inserter) => inserterItemsPerSecond(inserter, capacityBonus, belt, reach));

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

function capacities(rows: ReadonlyArray<readonly [number, ...number[]]>) {
  return rows.map(([capacity, ...rates]) => ({
    capacity,
    byBeltSpeed: rates.map((rate, index) => [15 * (index + 1), rate] as const),
  }));
}

function bulkRate(
  capacities: ThroughputGrid[number]['capacities'],
  rotationSpeed: number,
  capacity: number,
  beltSpeed: number,
): number {
  // The wiki has only one bulk-inserter motion speed (0.04 turns/tick).
  return capacityRate(capacities, capacity, beltSpeed) * (rotationSpeed / 0.04);
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
