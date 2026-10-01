import { DEFAULT_ROUTING_OPTIONS } from './conflict-search.ts';
import { findPath, validPathGrid } from './path-search.ts';
import type { RoutingInput, RoutingOptions, RoutingResult } from './types.ts';

/**
 * Independently route every pair, then permanently block cells wanted by two or more paths.
 * Keep each completed generation and its per-cell maximum. Unreachable pairs contribute no cells;
 * a budget-interrupted generation is discarded because its counts would be incomplete.
 * Underground interiors do not occupy grid squares, so only their surface endpoints are counted.
 */
export function computeRoutingContention(
  input: RoutingInput,
  options: RoutingOptions = {},
  iterations = 3,
): RoutingResult {
  const maxPathStates = options.maxPathStates ?? DEFAULT_ROUTING_OPTIONS.maxPathStates;
  const reach = options.undergroundBeltReach;
  if (
    !validPathGrid(input) ||
    !Array.isArray(input.routes) ||
    input.routes.length > input.width * input.height ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    !Number.isSafeInteger(maxPathStates) ||
    maxPathStates < 0 ||
    (reach !== undefined && (!Number.isSafeInteger(reach) || reach < 0))
  )
    return { kind: 'invalid', message: 'Invalid contention grid, requests, or search options.' };

  const ids = new Set<string>();
  for (const route of input.routes) {
    if (!route || typeof route.id !== 'string' || !route.id.trim() || ids.has(route.id))
      return { kind: 'invalid', message: 'Routes must have unique, nonempty identities.' };
    ids.add(route.id);
    for (const cell of [route.start, route.goal]) {
      if (
        !cell ||
        !Number.isSafeInteger(cell.x) ||
        !Number.isSafeInteger(cell.y) ||
        cell.x < 0 ||
        cell.x >= input.width ||
        cell.y < 0 ||
        cell.y >= input.height
      )
        return {
          kind: 'invalid',
          message: 'Route endpoints must be integer cells inside the grid.',
        };
    }
  }
  const blocked = input.blocked.slice();
  const maximum = new Uint32Array(blocked.length);
  const generations: Uint32Array[] = [];
  const budget = { remaining: maxPathStates };
  let pathSearches = 0;
  const finish = (status: 'complete' | 'budget-exhausted'): RoutingResult => ({
    kind: 'contention',
    generations,
    maximum,
    status,
    diagnostics: {
      pathSearches,
      pathStates: maxPathStates - budget.remaining,
      expandedNodes: 0,
      generatedNodes: 0,
    },
  });
  const requests = [...input.routes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const counts = new Uint32Array(blocked.length);
    for (const { start, goal } of requests) {
      pathSearches++;
      const path = findPath(
        { ...input, blocked, start, goal, undergroundBeltReach: reach },
        budget,
      );
      if (path.kind === 'invalid') return path;
      if (path.kind === 'budget-exhausted') return finish('budget-exhausted');
      if (path.kind === 'found') {
        const occupied = new Set(path.cells.map(({ x, y }) => y * input.width + x));
        for (const index of occupied) counts[index]++;
      }
    }
    let contested = false;
    for (let index = 0; index < counts.length; index++) {
      if (counts[index] < 2) {
        counts[index] = 0;
        continue;
      }
      contested = true;
      maximum[index] = Math.max(maximum[index], counts[index]);
      blocked[index] = 1;
    }
    generations.push(counts);
    if (!contested) break;
  }
  return finish('complete');
}
