export type ThroughputGrid = ReadonlyArray<{
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

export type InserterStyle = 'upstream' | 'bobs';

/** Measured rates in items/s, before the requested reach adjustment. */
export interface InserterPerformance {
  readonly style: InserterStyle;
  readonly chestToBelt: ThroughputGrid;
  readonly beltToChest: ThroughputGrid;
  readonly bulkChestToBelt: ThroughputGrid[number]['capacities'];
  readonly bulkBeltToChest: ThroughputGrid[number]['capacities'];
  readonly bulkRotationSpeed: number;
}

export const bobsInserterPerformance: InserterPerformance = {
  style: 'bobs',
  chestToBelt: CHEST_TO_BELT,
  beltToChest: BELT_TO_CHEST,
  bulkChestToBelt: BULK_CHEST_TO_BELT,
  bulkBeltToChest: BULK_BELT_TO_CHEST,
  bulkRotationSpeed: 0.04,
};

function capacities(rows: ReadonlyArray<readonly [number, ...number[]]>) {
  return rows.map(([capacity, ...rates]) => ({
    capacity,
    byBeltSpeed: rates.map((rate, index) => [15 * (index + 1), rate] as const),
  }));
}
