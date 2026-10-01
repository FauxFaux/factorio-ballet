import type { RoutingDebugState } from '../../boot/url-handler.tsx';

export interface PathCell {
  x: number;
  y: number;
}

export type PathDirection = 'east' | 'south' | 'west' | 'north';

/** Row-major occupancy: nonzero cells are blocked. Endpoints must be unblocked. */
export interface PathSearchInput {
  width: number;
  height: number;
  blocked: Uint8Array;
  start: PathCell;
  goal: PathCell;
  /** Optional travel directions on departure from start and arrival at goal. */
  startDirection?: PathDirection;
  goalDirection?: PathDirection;
}

export type PathSearchResult =
  | { kind: 'found'; cells: PathCell[]; steps: number; turns: number }
  | { kind: 'no-path' }
  | { kind: 'invalid'; message: string };

export type PathSearchNormalization =
  | { kind: 'ok'; input: PathSearchInput }
  | { kind: 'invalid'; message: string };

/** Bound allocations and synchronous search work for user-controlled URL state. */
export const MAX_PATH_SEARCH_CELLS = 262_144;

const directions: PathDirection[] = ['east', 'south', 'west', 'north'];
const offsets = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function validSize(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    width > 0 &&
    Number.isSafeInteger(height) &&
    height > 0 &&
    width * height <= MAX_PATH_SEARCH_CELLS
  );
}

function inside(cell: PathCell, width: number, height: number): boolean {
  return (
    Number.isSafeInteger(cell?.x) &&
    Number.isSafeInteger(cell?.y) &&
    cell.x >= 0 &&
    cell.x < width &&
    cell.y >= 0 &&
    cell.y < height
  );
}

/**
 * Convert debug geometry once into occupancy. Explicit endpoints may be free cells or a source
 * and sink respectively; all other entities block routing. Endpoint arrows constrain travel.
 * This is one geometric route, without rate allocation, undergrounds, or multi-route reservation.
 */
export function normalizeRoutingDebugState(
  state: RoutingDebugState,
  start: PathCell,
  goal: PathCell,
): PathSearchNormalization {
  const width = state.width ?? 96;
  const height = state.height ?? 64;
  const invalid = (message: string): PathSearchNormalization => ({ kind: 'invalid', message });
  if (!validSize(width, height))
    return invalid(
      `Grid dimensions must be positive integers with at most ${MAX_PATH_SEARCH_CELLS} cells.`,
    );
  if (!inside(start, width, height) || !inside(goal, width, height))
    return invalid('Endpoints must be integer cells inside the grid.');
  const rectangles = state.rectangles ?? [];
  const entities = state.entities ?? [];
  if (!Array.isArray(rectangles) || !Array.isArray(entities))
    return invalid('Rectangles and entities must be arrays.');
  const blocked = new Uint8Array(width * height);
  for (const rectangle of rectangles) {
    if (
      !rectangle ||
      !inside(rectangle, width, height) ||
      !Number.isSafeInteger(rectangle.width) ||
      !Number.isSafeInteger(rectangle.height) ||
      rectangle.width <= 0 ||
      rectangle.height <= 0 ||
      rectangle.width > width - rectangle.x ||
      rectangle.height > height - rectangle.y
    )
      return invalid(
        'Reserved rectangles must have positive integer sizes and lie inside the grid.',
      );
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++)
      blocked.fill(1, y * width + rectangle.x, y * width + rectangle.x + rectangle.width);
  }
  const occupied = new Set<number>();
  let source: (typeof entities)[number] | undefined;
  let sink: (typeof entities)[number] | undefined;
  for (const entity of entities) {
    if (
      !entity ||
      !inside(entity, width, height) ||
      (entity.kind !== 'source' && entity.kind !== 'sink') ||
      !directions.includes(entity.direction) ||
      typeof entity.item !== 'string' ||
      !entity.item.trim() ||
      !Number.isFinite(entity.rate) ||
      entity.rate <= 0
    )
      return invalid(
        'Entities must have valid cells, kinds, directions, items, and positive rates.',
      );
    const cell = entity.y * width + entity.x;
    if (occupied.has(cell) || blocked[cell])
      return invalid('Entities must not overlap each other or reserved space.');
    occupied.add(cell);
    if (entity.x === start.x && entity.y === start.y) {
      if (entity.kind !== 'source') return invalid('The start entity must be a source.');
      source = entity;
    } else if (entity.x === goal.x && entity.y === goal.y) {
      if (entity.kind !== 'sink') return invalid('The goal entity must be a sink.');
      sink = entity;
    } else blocked[cell] = 1;
  }
  if (source && sink && source.item !== sink.item)
    return invalid('Source and sink must carry the same item.');
  if (blocked[start.y * width + start.x] || blocked[goal.y * width + goal.x])
    return invalid('Endpoints must not occupy reserved space.');
  return {
    kind: 'ok',
    input: {
      width,
      height,
      blocked,
      start: { ...start },
      goal: { ...goal },
      startDirection: source?.direction,
      goalDirection: sink?.direction,
    },
  };
}

type Entry = { state: number; steps: number; turns: number; estimate: number };

function precedes(a: Entry, b: Entry): boolean {
  return (
    a.estimate < b.estimate ||
    (a.estimate === b.estimate &&
      (a.turns < b.turns ||
        (a.turns === b.turns && (a.steps > b.steps || (a.steps === b.steps && a.state < b.state)))))
  );
}

/** Binary min-heap; obsolete entries are discarded when popped. */
class Frontier {
  private entries: Entry[] = [];

  push(entry: Entry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!precedes(entry, this.entries[parent])) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): Entry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!last || !this.entries.length) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.entries.length && precedes(this.entries[child + 1], this.entries[child]))
        child++;
      if (!precedes(this.entries[child], last)) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

/**
 * Four-neighbor A*: minimize steps, then turns among equally short paths. Manhattan distance
 * lower-bounds remaining steps; zero lower-bounds remaining turns. Incoming heading is part of
 * each search state, since two visits to one cell can have different future turn costs.
 * Returns ordered path cells, including both endpoints, rather than the search's explored cells.
 */
export function findPath(input: PathSearchInput): PathSearchResult {
  const { width, height, blocked, start, goal, startDirection, goalDirection } = input;
  if (
    !validSize(width, height) ||
    !(blocked instanceof Uint8Array) ||
    blocked.length !== width * height ||
    !inside(start, width, height) ||
    !inside(goal, width, height) ||
    (startDirection !== undefined && !directions.includes(startDirection)) ||
    (goalDirection !== undefined && !directions.includes(goalDirection))
  )
    return { kind: 'invalid', message: 'Invalid path search grid, endpoints, or directions.' };
  const startCell = start.y * width + start.x;
  const goalCell = goal.y * width + goal.x;
  if (blocked[startCell] || blocked[goalCell]) return { kind: 'no-path' };
  if (startCell === goalCell) return { kind: 'found', cells: [{ ...start }], steps: 0, turns: 0 };

  const initial = width * height * 4;
  const steps = new Int32Array(initial + 1).fill(-1);
  const turns = new Int32Array(initial + 1);
  const parents = new Int32Array(initial + 1).fill(-1);
  const frontier = new Frontier();
  const distance = (x: number, y: number) => Math.abs(goal.x - x) + Math.abs(goal.y - y);
  steps[initial] = 0;
  frontier.push({ state: initial, steps: 0, turns: 0, estimate: distance(start.x, start.y) });

  for (let current = frontier.pop(); current; current = frontier.pop()) {
    if (steps[current.state] !== current.steps || turns[current.state] !== current.turns) continue;
    const cell = current.state === initial ? startCell : Math.floor(current.state / 4);
    if (cell === goalCell) {
      const cells: PathCell[] = [];
      for (let state = current.state; state !== -1; state = parents[state]) {
        const index = state === initial ? startCell : Math.floor(state / 4);
        cells.push({ x: index % width, y: Math.floor(index / width) });
      }
      return { kind: 'found', cells: cells.reverse(), steps: current.steps, turns: current.turns };
    }
    const x = cell % width;
    const y = Math.floor(cell / width);
    for (let direction = 0; direction < 4; direction++) {
      if (current.state === initial && startDirection && directions[direction] !== startDirection)
        continue;
      const nextX = x + offsets[direction].x;
      const nextY = y + offsets[direction].y;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      const nextCell = nextY * width + nextX;
      if (blocked[nextCell] || nextCell === startCell) continue;
      if (nextCell === goalCell && goalDirection && directions[direction] !== goalDirection)
        continue;
      const state = nextCell * 4 + direction;
      const nextSteps = current.steps + 1;
      const nextTurns =
        current.turns + Number(current.state !== initial && current.state % 4 !== direction);
      if (
        steps[state] !== -1 &&
        (steps[state] < nextSteps || (steps[state] === nextSteps && turns[state] <= nextTurns))
      )
        continue;
      steps[state] = nextSteps;
      turns[state] = nextTurns;
      parents[state] = current.state;
      frontier.push({
        state,
        steps: nextSteps,
        turns: nextTurns,
        estimate: nextSteps + distance(nextX, nextY),
      });
    }
  }
  return { kind: 'no-path' };
}

/** Validate, rasterize, and solve a single route in the debug workspace. */
export function solveRoutingDebugPath(
  state: RoutingDebugState,
  start: PathCell,
  goal: PathCell,
): PathSearchResult {
  const normalized = normalizeRoutingDebugState(state, start, goal);
  return normalized.kind === 'ok' ? findPath(normalized.input) : normalized;
}
