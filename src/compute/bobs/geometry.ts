import type { Point } from './types.ts';

const ROTATION_DEGREES_PER_SECOND = 2160;
const EXTENSION_TILES_PER_SECOND = 0.1 * 60;
const HAND_SIZE = 24;

/** Shortest round trip, with rotation and radial extension happening simultaneously. */
export function bobCycleSeconds(pickup: Point, dropoff: Point): number {
  const a = Math.hypot(pickup.x, pickup.y);
  const b = Math.hypot(dropoff.x, dropoff.y);
  if (
    ![pickup.x, pickup.y, dropoff.x, dropoff.y].every(Number.isInteger) ||
    !a ||
    !b ||
    Math.abs(pickup.x) + Math.abs(pickup.y) > 3 ||
    Math.abs(dropoff.x) + Math.abs(dropoff.y) > 3 ||
    (pickup.x === dropoff.x && pickup.y === dropoff.y)
  )
    return 0;
  const cross = pickup.x * dropoff.y - pickup.y * dropoff.x;
  const dot = pickup.x * dropoff.x + pickup.y * dropoff.y;
  const degrees = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
  const rotationSeconds = degrees / ROTATION_DEGREES_PER_SECOND;
  const extensionSeconds = Math.abs(a - b) / EXTENSION_TILES_PER_SECOND;
  return 2 * Math.max(rotationSeconds, extensionSeconds);
}

/** Zero means an invalid endpoint pair, never infinite throughput. */
export function bobCapacity(pickup: Point, dropoff: Point): number {
  const seconds = bobCycleSeconds(pickup, dropoff);
  return seconds ? HAND_SIZE / seconds : 0;
}

interface BobSwing {
  readonly pickup: Readonly<Point>;
  readonly dropoff: Readonly<Point>;
  readonly cycleSeconds: number;
  readonly capacity: number;
}

/** Precompute all 24 × 23 distinct, nonzero pairs once for the solver's allowed table. */
const swings: readonly BobSwing[] = computeSwings();

export function bobSwings(): readonly BobSwing[] {
  return swings;
}

function computeSwings(): BobSwing[] {
  const points: Point[] = [];
  for (let x = -3; x <= 3; x++) {
    for (let y = -3; y <= 3; y++) {
      if (Math.abs(x) + Math.abs(y) > 0 && Math.abs(x) + Math.abs(y) <= 3) points.push({ x, y });
    }
  }
  return points.flatMap((pickup) =>
    points.flatMap((dropoff) => {
      const capacity = bobCapacity(pickup, dropoff);
      return capacity
        ? [{ pickup, dropoff, cycleSeconds: bobCycleSeconds(pickup, dropoff), capacity }]
        : [];
    }),
  );
}
