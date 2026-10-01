import {
  findPath,
  validPathGrid,
  type PathSearchBudget,
  type PathSearchResult,
} from './path-search.ts';
import { findReservationRoutes } from './reservation-search.ts';
import type {
  RoutedPath,
  RoutingConflict,
  RoutingDiagnostics,
  RoutingInput,
  RoutingOptions,
  RoutingResult,
} from './types.ts';

export const DEFAULT_ROUTING_OPTIONS = {
  maxPathStates: 2_000_000,
  maxNodes: 4_096,
  maxReservationStates: 50_000,
  costSlack: 0.2,
} as const;

interface Node {
  serial: number;
  constraints: number[][];
  routes: RoutedPath[];
  cost: number;
  steps: number;
  turns: number;
  overlaps: number;
  conflict?: { first: number; second: number; cell: number };
}

function cheaper(a: Node, b: Node): boolean {
  return (
    a.cost < b.cost ||
    (a.cost === b.cost &&
      (a.steps < b.steps ||
        (a.steps === b.steps &&
          (a.turns < b.turns || (a.turns === b.turns && a.serial < b.serial)))))
  );
}

function fewerConflicts(a: Node, b: Node): boolean {
  return a.overlaps < b.overlaps || (a.overlaps === b.overlaps && cheaper(a, b));
}

/**
 * Try whole-path reservation in a few deterministic orders before static conflict-based routing.
 * For the fallback, use deterministic focal selection and branch on one shared cell,
 * forbidding it for either route, and replan only that route. Other paths remain provisional.
 * This stops at the first valid layout; costSlack favors feasibility over proving optimality.
 * All budgets count work, never time, and all tie-breaks depend only on canonical input order.
 *
 * Fixed endpoint reservations are sound: another route can never use a required endpoint.
 * Constraints and unchanged paths are shared between nodes. Occupancy scratch and single-route
 * results are reused; the bounded frontier is small enough for a linear focal selection.
 */
export function solveConflictRouting(
  input: RoutingInput,
  options: RoutingOptions = {},
): RoutingResult {
  const { width, height } = input;
  const maxPathStates = options.maxPathStates ?? DEFAULT_ROUTING_OPTIONS.maxPathStates;
  const maxNodes = options.maxNodes ?? DEFAULT_ROUTING_OPTIONS.maxNodes;
  const maxReservationStates =
    options.maxReservationStates ?? DEFAULT_ROUTING_OPTIONS.maxReservationStates;
  const costSlack = options.costSlack ?? DEFAULT_ROUTING_OPTIONS.costSlack;
  if (
    !validPathGrid(input) ||
    !Array.isArray(input.routes) ||
    input.routes.length > width * height ||
    !Number.isSafeInteger(maxPathStates) ||
    maxPathStates < 0 ||
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 0 ||
    !Number.isSafeInteger(maxReservationStates) ||
    maxReservationStates < 0 ||
    !Number.isFinite(costSlack) ||
    costSlack < 0 ||
    costSlack > 1
  )
    return { kind: 'invalid', message: 'Invalid routing grid, requests, or search budgets.' };

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
        cell.y < 0 ||
        cell.x >= width ||
        cell.y >= height
      )
        return {
          kind: 'invalid',
          message: 'Route endpoints must be integer cells inside the grid.',
        };
    }
  }
  // Code-point ordering avoids locale-dependent results, including for non-ASCII item names.
  const requests = [...input.routes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const budget = { remaining: maxPathStates };
  const diagnostics: RoutingDiagnostics = {
    pathSearches: 0,
    pathStates: 0,
    expandedNodes: 0,
    generatedNodes: 0,
    reservationPasses: 0,
  };
  const finish = (kind: 'no-solution' | 'budget-exhausted'): RoutingResult => ({
    kind,
    diagnostics: { ...diagnostics, pathStates: maxPathStates - budget.remaining },
  });
  const base = input.blocked.slice();
  const endpointOwners = new Int32Array(width * height).fill(-1);
  for (const [index, request] of requests.entries()) {
    for (const point of [request.start, request.goal]) {
      const cell = point.y * width + point.x;
      const owner = endpointOwners[cell];
      if (input.blocked[cell]) return finish('no-solution');
      if (owner !== -1 && owner !== index) {
        diagnostics.remainingConflicts = 1;
        diagnostics.conflict = {
          first: requests[owner].id,
          second: request.id,
          cell: { ...point },
        };
        return finish('no-solution');
      }
      endpointOwners[cell] = index;
      base[cell] = 1;
    }
  }
  const blocked = base.slice();
  const caches = requests.map(() => new Map<string, PathSearchResult>());
  const search = (
    index: number,
    constraints: number[],
    allowance: PathSearchBudget = budget,
  ): PathSearchResult => {
    const key = constraints.join(',');
    const cached = caches[index].get(key);
    if (cached) return cached;
    const request = requests[index];
    const start = request.start.y * width + request.start.x;
    const goal = request.goal.y * width + request.goal.x;
    blocked[start] = blocked[goal] = 0;
    for (const cell of constraints) blocked[cell] = 1;
    diagnostics.pathSearches++;
    const result = findPath(
      { ...input, blocked, start: request.start, goal: request.goal },
      allowance,
    );
    for (const cell of constraints) blocked[cell] = base[cell];
    blocked[start] = blocked[goal] = 1;
    if (result.kind === 'found' || result.kind === 'no-path') caches[index].set(key, result);
    return result;
  };

  const rootPaths: RoutedPath[] = [];
  for (let index = 0; index < requests.length; index++) {
    const result = search(index, []);
    if (result.kind === 'invalid') return result;
    if (result.kind === 'budget-exhausted') return finish('budget-exhausted');
    if (result.kind === 'no-path') return finish('no-solution');
    rootPaths.push({ ...result, id: requests[index].id });
  }

  const owners = new Int32Array(width * height);
  const stamps = new Uint32Array(width * height);
  const inspect = (routes: RoutedPath[], constraints: number[][]): Node => {
    const serial = ++diagnostics.generatedNodes;
    const node: Node = { serial, routes, constraints, cost: 0, steps: 0, turns: 0, overlaps: 0 };
    for (const [index, route] of routes.entries()) {
      node.cost += route.cost;
      node.steps += route.steps;
      node.turns += route.turns;
      for (const point of route.cells) {
        const cell = point.y * width + point.x;
        if (stamps[cell] !== serial) {
          stamps[cell] = serial;
          owners[cell] = index;
        } else if (owners[cell] !== index) {
          node.overlaps++;
          node.conflict ??= { first: owners[cell], second: index, cell };
        }
      }
    }
    return node;
  };
  const describeConflict = (node: Node): RoutingConflict | undefined => {
    const conflict = node.conflict;
    return (
      conflict && {
        first: requests[conflict.first].id,
        second: requests[conflict.second].id,
        cell: { x: conflict.cell % width, y: Math.floor(conflict.cell / width) },
      }
    );
  };
  const found = (node: Node): RoutingResult => ({
    kind: 'found',
    routes: node.routes,
    cost: node.cost,
    steps: node.steps,
    turns: node.turns,
    diagnostics: {
      ...diagnostics,
      pathStates: maxPathStates - budget.remaining,
      remainingConflicts: 0,
      conflict: undefined,
    },
  });
  const root = inspect(
    rootPaths,
    requests.map(() => []),
  );
  if (!Number.isFinite(root.cost))
    return { kind: 'invalid', message: 'Routing costs exceed the numeric range.' };
  if (!root.conflict) return found(root);

  // Reservation failures are heuristic, so leave most of the shared work budget for CBS.
  // Separate counters let a reservation pass stop without exhausting the overall solve.
  const reservationAllowance =
    maxNodes === 0 ? 0 : Math.min(maxReservationStates, Math.floor(budget.remaining / 4));
  if (reservationAllowance > 0) {
    const reservationBudget = { remaining: reservationAllowance };
    const reservation = findReservationRoutes(rootPaths, width, search, reservationBudget);
    budget.remaining -= reservationAllowance - reservationBudget.remaining;
    diagnostics.reservationPasses = reservation.passes;
    if (reservation.kind === 'invalid') return { kind: 'invalid', message: reservation.message };
    if (reservation.kind === 'found') {
      const candidate = inspect(reservation.routes, root.constraints);
      if (!Number.isFinite(candidate.cost))
        return { kind: 'invalid', message: 'Routing costs exceed the numeric range.' };
      if (!candidate.conflict) return found(candidate);
    }
  }
  const frontier = [root];
  const seen = new Set<string>([JSON.stringify(root.constraints)]);
  let best = root;
  diagnostics.remainingConflicts = root.overlaps;
  diagnostics.conflict = describeConflict(root);
  while (frontier.length) {
    let cheapest = frontier[0];
    for (const node of frontier) if (cheaper(node, cheapest)) cheapest = node;
    const allowance = cheapest.cost * (1 + costSlack);
    let selected = frontier.indexOf(cheapest);
    for (let index = 0; index < frontier.length; index++) {
      if (frontier[index].cost <= allowance && fewerConflicts(frontier[index], frontier[selected]))
        selected = index;
    }
    const [node] = frontier.splice(selected, 1);
    if (!node.conflict) return found(node);
    if (diagnostics.expandedNodes === maxNodes) return finish('budget-exhausted');
    diagnostics.expandedNodes++;
    const { first, second, cell } = node.conflict;
    for (const index of [first, second]) {
      const constraints = [...node.constraints];
      constraints[index] = [...constraints[index], cell].sort((a, b) => a - b);
      const key = JSON.stringify(constraints);
      if (seen.has(key)) continue;
      seen.add(key);
      const result = search(index, constraints[index]);
      if (result.kind === 'invalid') return result;
      if (result.kind === 'budget-exhausted') return finish('budget-exhausted');
      if (result.kind === 'no-path') continue;
      const routes = [...node.routes];
      routes[index] = { ...result, id: requests[index].id };
      const child = inspect(routes, constraints);
      if (!Number.isFinite(child.cost))
        return { kind: 'invalid', message: 'Routing costs exceed the numeric range.' };
      if (fewerConflicts(child, best)) {
        best = child;
        diagnostics.remainingConflicts = child.overlaps;
        diagnostics.conflict = describeConflict(child);
      }
      // A valid incumbent is useful immediately, even if the sibling exceeds its budget.
      if (!child.conflict) return found(child);
      frontier.push(child);
    }
  }
  return finish('no-solution');
}
