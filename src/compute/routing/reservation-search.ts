import type { PathSearchBudget, PathSearchResult } from './path-search.ts';
import type { RoutedPath } from './types.ts';

type ReservationResult =
  | { kind: 'found'; routes: RoutedPath[]; passes: number }
  | { kind: 'not-found'; passes: number }
  | { kind: 'invalid'; message: string; passes: number };

/**
 * Try a small, deterministic set of priorities, reserving complete paths rather than resolving
 * their overlaps cell by cell. This is only a heuristic: failed orders never prove infeasibility.
 * The caller supplies endpoint-aware single-route search and a separate bounded allowance.
 * Keep the cheapest valid collection among the attempted orders, even if a later pass stops.
 */
export function findReservationRoutes(
  independent: RoutedPath[],
  width: number,
  search: (index: number, constraints: number[], budget: PathSearchBudget) => PathSearchResult,
  budget: PathSearchBudget,
): ReservationResult {
  const canonical = independent.map((_, index) => index);
  const shortest = [...canonical].sort(
    (a, b) => independent[a].cost - independent[b].cost || a - b,
  );
  const longest = [...canonical].sort((a, b) => independent[b].cost - independent[a].cost || a - b);
  const orders = [shortest, longest, canonical, [...canonical].reverse()];
  const seen = new Set<string>();
  let passes = 0;
  let best: { routes: RoutedPath[]; cost: number; steps: number; turns: number } | undefined;
  for (const order of orders) {
    const key = order.join(',');
    if (seen.has(key)) continue;
    if (budget.remaining === 0) break;
    seen.add(key);
    passes++;
    const occupied = new Set<number>();
    const routes: RoutedPath[] = [];
    let cost = 0;
    let steps = 0;
    let turns = 0;
    for (const index of order) {
      const constraints = [...occupied].sort((a, b) => a - b);
      const result = search(index, constraints, budget);
      if (result.kind === 'invalid') return { ...result, passes };
      if (result.kind !== 'found') break;
      routes[index] = { ...result, id: independent[index].id };
      cost += result.cost;
      steps += result.steps;
      turns += result.turns;
      for (const { x, y } of result.cells) occupied.add(y * width + x);
    }
    if (
      order.every((index) => routes[index] !== undefined) &&
      (!best ||
        cost < best.cost ||
        (cost === best.cost &&
          (steps < best.steps || (steps === best.steps && turns < best.turns))))
    )
      best = { routes, cost, steps, turns };
  }
  return best ? { kind: 'found', routes: best.routes, passes } : { kind: 'not-found', passes };
}
