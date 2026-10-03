import { Frontier, type Entry } from './path-search-frontier.ts';
import { resolvePathSelfConflicts, type RelaxedPathResult } from './path-self-conflicts.ts';
import {
  findPath,
  type PathSearchInput,
  type PathSearchBudget,
  type PathSearchResult,
  type UndergroundBeltSpan,
} from './path-search.ts';

const directions = ['east', 'south', 'west', 'north'] as const;
const offsets = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/** Closed collinear spans conflict, including nested or oppositely directed pairs. */
export function undergroundBeltsCollide(a: UndergroundBeltSpan, b: UndergroundBeltSpan): boolean {
  const horizontal = a.entry.y === a.exit.y;
  if (horizontal !== (b.entry.y === b.exit.y)) return false;
  const axis = horizontal ? 'x' : 'y';
  const line = horizontal ? 'y' : 'x';
  return (
    a.entry[line] === b.entry[line] &&
    Math.max(Math.min(a.entry[axis], a.exit[axis]), Math.min(b.entry[axis], b.exit[axis])) <=
      Math.min(Math.max(a.entry[axis], a.exit[axis]), Math.max(b.entry[axis], b.exit[axis]))
  );
}

export function validUndergroundInput(input: PathSearchInput): boolean {
  const { undergroundBeltReach: reach, undergroundBelts: belts, width, height } = input;
  if (reach !== undefined && (!Number.isSafeInteger(reach) || reach < 0)) return false;
  for (const [pairs, reserved] of [
    [belts, true],
    [input.forbiddenUndergroundBelts, false],
  ] as const) {
    if (pairs === undefined) continue;
    if (!Array.isArray(pairs) || (reserved && pairs.length * 2 > width * height)) return false;
    const endpoints = new Set<number>();
    for (const [index, belt] of pairs.entries()) {
      for (const point of [belt?.entry, belt?.exit]) {
        if (
          !point ||
          !Number.isSafeInteger(point.x) ||
          !Number.isSafeInteger(point.y) ||
          point.x < 0 ||
          point.x >= width ||
          point.y < 0 ||
          point.y >= height
        )
          return false;
        const cell = point.y * width + point.x;
        if (reserved && endpoints.has(cell)) return false;
        endpoints.add(cell);
      }
      if ((belt.entry.x === belt.exit.x) === (belt.entry.y === belt.exit.y)) return false;
      if (reserved)
        for (let previous = 0; previous < index; previous++)
          if (undergroundBeltsCollide(belt, pairs[previous])) return false;
    }
  }
  return true;
}

interface Label extends Entry {
  cell: number;
  direction: number;
  parent: number;
  /** Surface cells added by the incoming move, in travel order. */
  surface: number[];
  /** Identity of the incoming atomic move, independent of the incoming heading. */
  move: number;
  belts: UndergroundBeltSpan[];
  key: number;
}

/**
 * A tunnel move consumes alignment -> entry -> exit -> next decision atomically. Only entry,
 * exit and the decision cell reserve surface space; all travel counts towards distance.
 * Most routes use a relaxed search keyed only by cell and heading, as surface A* does. A found
 * route is checked for surface reuse and parallel tunnel overlap. Self-conflicts branch on
 * excluding either offending move, keeping cell/heading sufficient for every replan.
 * All searches consume the same expansion budget.
 */
export function findUndergroundPath(
  input: PathSearchInput,
  budget?: PathSearchBudget,
): PathSearchResult {
  const { width, start, goal, undergroundBeltReach: reach } = input;
  const existing = input.undergroundBelts ?? [];
  const blocked = input.blocked.slice();
  for (const belt of existing)
    for (const endpoint of [belt.entry, belt.exit]) blocked[endpoint.y * width + endpoint.x] = 1;
  if (reach === undefined)
    return findPath({ ...input, blocked, undergroundBelts: undefined }, budget);
  const startCell = start.y * width + start.x;
  const goalCell = goal.y * width + goal.x;
  if (blocked[startCell] || blocked[goalCell]) return { kind: 'no-path' };
  if (startCell === goalCell)
    return {
      kind: 'found',
      cells: [{ ...start }],
      undergroundBelts: [],
      cost: 0,
      steps: 0,
      turns: 0,
    };

  const normalized = { ...input, blocked, undergroundBeltReach: reach };
  return resolvePathSelfConflicts((forbidden) =>
    searchUndergroundPath(normalized, budget, forbidden),
  );
}

/**
 * Ignoring self-collisions makes cell/heading a sufficient state: remaining moves and costs depend
 * only on the static grid, heading, and excluded atomic moves. Return the first placement conflict
 * alongside the relaxed optimum; a valid path cannot contain both conflicting moves.
 */
function searchUndergroundPath(
  input: PathSearchInput & { undergroundBeltReach: number },
  budget: PathSearchBudget | undefined,
  forbidden: ReadonlySet<number>,
): RelaxedPathResult {
  const { width, height, start, goal, blocked, penalties, undergroundBeltReach: reach } = input;
  const existing = input.undergroundBelts ?? [];
  const maxLength = Math.min(reach + 3, Math.max(width, height));
  const point = (cell: number) => ({ x: cell % width, y: Math.floor(cell / width) });
  const startCell = start.y * width + start.x;
  const goalCell = goal.y * width + goal.x;
  const distance = (cell: number) => {
    const { x, y } = point(cell);
    return Math.abs(goal.x - x) + Math.abs(goal.y - y);
  };
  const labels: Label[] = [];
  const best = new Map<number, Label>();
  const frontier = new Frontier();
  const initial: Label = {
    state: 0,
    cell: startCell,
    direction: -1,
    parent: -1,
    surface: [startCell],
    move: -1,
    belts: [],
    key: width * height * 4,
    cost: 0,
    steps: 0,
    turns: 0,
    estimate: distance(startCell),
    estimatedSteps: distance(startCell),
  };
  labels.push(initial);
  best.set(initial.key, initial);
  frontier.push(initial);

  for (let entry = frontier.pop(); entry; entry = frontier.pop()) {
    const current = labels[entry.state];
    if (best.get(current.key) !== current) continue;
    if (budget) {
      if (budget.remaining === 0) return { path: { kind: 'budget-exhausted' } };
      budget.remaining--;
    }
    if (current.cell === goalCell) {
      const moves: Label[] = [];
      for (let label = current; ; label = labels[label.parent]) {
        moves.push(label);
        if (label.parent === -1) break;
      }
      moves.reverse();
      const surface = moves.flatMap((label) => label.surface);
      const owners = new Map<number, number>();
      const tunnels: { belt: UndergroundBeltSpan; move: number }[] = [];
      let conflict: [number, number] | undefined;
      for (const label of moves) {
        for (const cell of label.surface) {
          const owner = owners.get(cell);
          if (owner !== undefined) conflict ??= [owner, label.move];
          owners.set(cell, label.move);
        }
        if (label.surface.length === 3) {
          const belt = label.belts.at(-1)!;
          for (const other of tunnels)
            if (undergroundBeltsCollide(belt, other.belt)) conflict ??= [other.move, label.move];
          tunnels.push({ belt, move: label.move });
        }
        if (conflict) break;
      }
      return {
        path: {
          kind: 'found',
          cells: surface.map(point),
          undergroundBelts: current.belts,
          cost: current.cost,
          steps: current.steps,
          turns: current.turns,
        },
        conflict,
      };
    }
    const { x, y } = point(current.cell);
    for (const [direction, offset] of offsets.entries()) {
      // Both surface and atomic tunnel moves leave a surfaced cell immediately behind us.
      // Reversing would reuse it even when the next move starts another tunnel.
      if (current.direction !== -1 && direction === (current.direction + 2) % 4) continue;
      if (
        current.parent === -1 &&
        input.startDirection &&
        directions[direction] !== input.startDirection
      )
        continue;
      const cellAt = (length: number): number | undefined => {
        const nextX = x + offset.x * length;
        const nextY = y + offset.y * length;
        return nextX < 0 || nextX >= width || nextY < 0 || nextY >= height
          ? undefined
          : nextY * width + nextX;
      };
      const next = cellAt(1);
      if (next === undefined || blocked[next]) continue;
      // A zero-hidden-tile pair reserves the same cells and costs as three surface steps,
      // with the same heading and turns but an extra pair. It cannot improve a valid route.
      for (let length = 1; length <= maxLength; length++) {
        if (length === 2 || length === 3) continue;
        const move = (current.cell * 4 + direction) * (maxLength + 1) + length;
        if (forbidden.has(move)) continue;
        const decision = cellAt(length);
        if (decision === undefined) break;
        let surface = [next];
        let belt: UndergroundBeltSpan | undefined;
        if (length >= 3) {
          const exit = cellAt(length - 1)!;
          surface = [next, exit, decision];
          if (next === goalCell || exit === goalCell) continue;
          const candidate = { entry: point(next), exit: point(exit) };
          if (
            input.forbiddenUndergroundBelts?.some((other) => {
              const otherEntry = other.entry.y * width + other.entry.x;
              const otherExit = other.exit.y * width + other.exit.x;
              return (
                (next === otherEntry && exit === otherExit) ||
                (next === otherExit && exit === otherEntry)
              );
            }) ||
            existing.some((other) => undergroundBeltsCollide(candidate, other))
          )
            continue;
          belt = candidate;
        }
        if (surface.some((cell) => blocked[cell] || cell === startCell)) continue;
        if (
          decision === goalCell &&
          input.goalDirection &&
          directions[direction] !== input.goalDirection
        )
          continue;
        const steps = current.steps + length;
        const cost =
          current.cost + length + surface.reduce((sum, cell) => sum + (penalties?.[cell] ?? 0), 0);
        if (!Number.isFinite(cost))
          return { path: { kind: 'invalid', message: 'Path costs exceed the numeric range.' } };
        const turns =
          current.turns + Number(current.direction !== -1 && current.direction !== direction);
        const belts = belt ? [...current.belts, belt] : current.belts;
        const key = decision * 4 + direction;
        const previous = best.get(key);
        if (
          previous &&
          (previous.cost < cost ||
            (previous.cost === cost &&
              (previous.steps < steps ||
                (previous.steps === steps &&
                  (previous.turns < turns ||
                    (previous.turns === turns && previous.belts.length <= belts.length))))))
        )
          continue;
        const label: Label = {
          state: labels.length,
          cell: decision,
          direction,
          parent: current.state,
          surface,
          move,
          belts,
          key,
          cost,
          steps,
          turns,
          undergrounds: belts.length,
          estimate: cost + distance(decision),
          estimatedSteps: steps + distance(decision),
        };
        labels.push(label);
        best.set(key, label);
        frontier.push(label);
      }
    }
  }
  return { path: { kind: 'no-path' } };
}
