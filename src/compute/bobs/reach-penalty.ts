/** A soft exponential cost, continued linearly before integer coefficients overflow. */
export function bobReachPenalty(distance: number, doublingTiles: number): number {
  const excess = Math.max(0, distance - 3);
  const exponential = Math.min(excess, doublingTiles);
  const tail = excess - exponential;
  return 2 ** exponential - 1 + (tail > 0 ? tail * 2 ** doublingTiles : 0);
}
