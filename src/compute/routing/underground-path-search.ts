import { Frontier, type Entry } from './path-search-frontier.ts';
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
function collide(a: UndergroundBeltSpan, b: UndergroundBeltSpan): boolean {
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
  if (belts === undefined) return true;
  if (!Array.isArray(belts) || belts.length * 2 > width * height) return false;
  const endpoints = new Set<number>();
  for (const [index, belt] of belts.entries()) {
    for (const point of [belt?.entry, belt?.exit]) {
      if (
        !point ||
        !Number.isSafeInteger(point.x) ||
        !Number.isSafeInteger(point.y) ||
        point.x < 0 || point.x >= width || point.y < 0 || point.y >= height
      ) return false;
      const cell = point.y * width + point.x;
      if (endpoints.has(cell)) return false;
      endpoints.add(cell);
    }
    if ((belt.entry.x === belt.exit.x) === (belt.entry.y === belt.exit.y)) return false;
    for (let previous = 0; previous < index; previous++)
      if (collide(belt, belts[previous])) return false;
  }
  return true;
}

interface Label extends Entry {
  cell: number;
  direction: number;
  parent: number;
  /** Surface cells added by the incoming move, in travel order. */
  surface: number[];
  occupied: number[];
  belts: UndergroundBeltSpan[];
  key: string;
}

/**
 * A tunnel move consumes alignment -> entry -> exit -> next decision atomically. Only entry,
 * exit and the decision cell reserve surface space; all travel counts towards distance.
 * Unlike surface-only A*, labels retain placement history: different visits to the same cell
 * and heading can have different feasible futures. The caller's expansion budget still applies.
 */
export function findUndergroundPath(
  input: PathSearchInput,
  budget?: PathSearchBudget,
): PathSearchResult {
  const { width, height, start, goal, penalties, undergroundBeltReach: reach } = input;
  const existing = input.undergroundBelts ?? [];
  const blocked = input.blocked.slice();
  const point = (cell: number) => ({ x: cell % width, y: Math.floor(cell / width) });
  for (const belt of existing)
    for (const endpoint of [belt.entry, belt.exit]) blocked[endpoint.y * width + endpoint.x] = 1;
  if (reach === undefined)
    return findPath({ ...input, blocked, undergroundBelts: undefined }, budget);
  const startCell = start.y * width + start.x;
  const goalCell = goal.y * width + goal.x;
  if (blocked[startCell] || blocked[goalCell]) return { kind: 'no-path' };
  if (startCell === goalCell)
    return { kind: 'found', cells: [{ ...start }], undergroundBelts: [], cost: 0, steps: 0, turns: 0 };

  const distance = (cell: number) => {
    const { x, y } = point(cell);
    return Math.abs(goal.x - x) + Math.abs(goal.y - y);
  };
  const labels: Label[] = [];
  const best = new Map<string, Label>();
  const frontier = new Frontier();
  const initial: Label = {
    state: 0, cell: startCell, direction: -1, parent: -1, surface: [startCell],
    occupied: [startCell], belts: [], key: '', cost: 0, steps: 0, turns: 0,
    estimate: distance(startCell), estimatedSteps: distance(startCell),
  };
  labels.push(initial);
  best.set(initial.key, initial);
  frontier.push(initial);

  for (let entry = frontier.pop(); entry; entry = frontier.pop()) {
    const current = labels[entry.state];
    if (best.get(current.key) !== current) continue;
    if (budget) {
      if (budget.remaining === 0) return { kind: 'budget-exhausted' };
      budget.remaining--;
    }
    if (current.cell === goalCell) {
      const moves: number[][] = [];
      for (let label = current; ; label = labels[label.parent]) {
        moves.push(label.surface);
        if (label.parent === -1) break;
      }
      return {
        kind: 'found', cells: moves.reverse().flat().map(point),
        undergroundBelts: current.belts, cost: current.cost, steps: current.steps, turns: current.turns,
      };
    }
    const { x, y } = point(current.cell);
    for (const [direction, offset] of offsets.entries()) {
      if (current.parent === -1 && input.startDirection && directions[direction] !== input.startDirection)
        continue;
      const cellAt = (length: number): number | undefined => {
        const nextX = x + offset.x * length;
        const nextY = y + offset.y * length;
        return nextX < 0 || nextX >= width || nextY < 0 || nextY >= height
          ? undefined : nextY * width + nextX;
      };
      const next = cellAt(1);
      if (next === undefined || blocked[next] || current.occupied.includes(next)) continue;
      // A normal step, followed by all legal straight underground alternatives (including zero hidden tiles).
      for (let length = 1; length <= Math.min(reach + 3, Math.max(width, height)); length++) {
        if (length === 2) continue;
        const decision = cellAt(length);
        if (decision === undefined) break;
        let surface = [next];
        let belt: UndergroundBeltSpan | undefined;
        if (length >= 3) {
          const exit = cellAt(length - 1)!;
          surface = [next, exit, decision];
          if (next === goalCell || exit === goalCell) continue;
          belt = { entry: point(next), exit: point(exit) };
          if (existing.some((other) => collide(belt!, other)) || current.belts.some((other) => collide(belt!, other)))
            continue;
        }
        if (surface.some((cell) => blocked[cell] || current.occupied.includes(cell))) continue;
        if (decision === goalCell && input.goalDirection && directions[direction] !== input.goalDirection)
          continue;
        const steps = current.steps + length;
        const cost = current.cost + length + surface.reduce((sum, cell) => sum + (penalties?.[cell] ?? 0), 0);
        if (!Number.isFinite(cost))
          return { kind: 'invalid', message: 'Path costs exceed the numeric range.' };
        const turns = current.turns + Number(current.direction !== -1 && current.direction !== direction);
        const occupied = [...current.occupied, ...surface].sort((a, b) => a - b);
        const belts = belt ? [...current.belts, belt] : current.belts;
        const tunnels = belts.map(({ entry, exit }) => [entry.y * width + entry.x, exit.y * width + exit.x].sort((a, b) => a - b).join(':')).sort().join(';');
        const key = `${decision}/${direction}/${occupied.join(',')}/${tunnels}`;
        const previous = best.get(key);
        if (previous && (previous.cost < cost || (previous.cost === cost && (previous.steps < steps || (previous.steps === steps && previous.turns <= turns)))))
          continue;
        const label: Label = {
          state: labels.length, cell: decision, direction, parent: current.state, surface,
          occupied, belts, key, cost, steps, turns,
          estimate: cost + distance(decision), estimatedSteps: steps + distance(decision),
        };
        labels.push(label);
        best.set(key, label);
        frontier.push(label);
      }
    }
  }
  return { kind: 'no-path' };
}
