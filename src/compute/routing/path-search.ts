import type { RoutingDebugEntity, RoutingDebugState } from '../../boot/url-handler.tsx';

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
  /** Nonnegative row-major costs added when entering a cell. Absent means zero penalties. */
  penalties?: Float64Array;
  start: PathCell;
  goal: PathCell;
  /** Optional travel directions on departure from start and arrival at goal. */
  startDirection?: PathDirection;
  goalDirection?: PathDirection;
}

export type PathSearchResult =
  | { kind: 'found'; cells: PathCell[]; cost: number; steps: number; turns: number }
  | { kind: 'no-path' }
  | { kind: 'budget-exhausted' }
  | { kind: 'invalid'; message: string };

/** A deterministic expansion allowance shared across several single-path searches. */
export interface PathSearchBudget {
  remaining: number;
}

export type PathSearchGrid = Pick<PathSearchInput, 'width' | 'height' | 'blocked' | 'penalties'>;

export function validPathGrid({ width, height, blocked, penalties }: PathSearchGrid): boolean {
  return (
    validSize(width, height) &&
    blocked instanceof Uint8Array &&
    blocked.length === width * height &&
    (penalties === undefined ||
      (penalties instanceof Float64Array &&
        penalties.length === width * height &&
        penalties.every((cost) => Number.isFinite(cost) && cost >= 0)))
  );
}

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

/** The external tile supplied by a source or feeding a sink. */
export function connectionTile(
  entity: Pick<RoutingDebugEntity, 'x' | 'y' | 'kind' | 'direction'>,
): PathCell {
  const offset = offsets[directions.indexOf(entity.direction)];
  const sign = entity.kind === 'source' ? 1 : -1;
  return { x: entity.x + offset.x * sign, y: entity.y + offset.y * sign };
}

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
 * Validate and rasterize debug geometry once, independently of route endpoints. Entities may be
 * inside reserved buildings, but routing stays outside them. All entity tiles block routing.
 */
export function normalizeRoutingDebugGrid(
  state: RoutingDebugState,
): { kind: 'ok'; grid: PathSearchGrid } | { kind: 'invalid'; message: string } {
  const width = state.width ?? 96;
  const height = state.height ?? 64;
  const invalid = (message: string) => ({ kind: 'invalid' as const, message });
  if (!validSize(width, height))
    return invalid(
      `Grid dimensions must be positive integers with at most ${MAX_PATH_SEARCH_CELLS} cells.`,
    );
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
    if (occupied.has(cell)) return invalid('Entities must not overlap each other.');
    occupied.add(cell);
    blocked[cell] = 1;
  }
  return { kind: 'ok', grid: { width, height, blocked } };
}

/**
 * Resolve endpoints against a validated, rasterized grid. Endpoints can be free cells or a source
 * and sink respectively. Arrows select adjacent connection tiles, without constraining path headings.
 */
export function normalizeRoutingDebugEndpoints(
  state: RoutingDebugState,
  grid: PathSearchGrid,
  start: PathCell,
  goal: PathCell,
): PathSearchNormalization {
  const { width, height, blocked } = grid;
  const invalid = (message: string): PathSearchNormalization => ({ kind: 'invalid', message });
  if (!inside(start, width, height) || !inside(goal, width, height))
    return invalid('Endpoints must be integer cells inside the grid.');
  const entities = state.entities ?? [];
  const source = entities.find((entity) => entity.x === start.x && entity.y === start.y);
  const sink = entities.find((entity) => entity.x === goal.x && entity.y === goal.y);
  if (source && source.kind !== 'source') return invalid('The start entity must be a source.');
  if (sink && sink.kind !== 'sink') return invalid('The goal entity must be a sink.');
  if (source && sink && source.item !== sink.item)
    return invalid('Source and sink must carry the same item.');
  const pathStart = source ? connectionTile(source) : start;
  const pathGoal = sink ? connectionTile(sink) : goal;
  if (!inside(pathStart, width, height) || !inside(pathGoal, width, height))
    return invalid('Connection tiles must be inside the grid.');
  if (blocked[pathStart.y * width + pathStart.x] || blocked[pathGoal.y * width + pathGoal.x])
    return invalid('Endpoint connection tiles must not occupy reserved space or entities.');
  return {
    kind: 'ok',
    input: {
      ...grid,
      start: { ...pathStart },
      goal: { ...pathGoal },
    },
  };
}

/** Validate debug geometry and resolve one pair, preserving the single-route API. */
export function normalizeRoutingDebugState(
  state: RoutingDebugState,
  start: PathCell,
  goal: PathCell,
): PathSearchNormalization {
  const normalized = normalizeRoutingDebugGrid(state);
  return normalized.kind === 'ok'
    ? normalizeRoutingDebugEndpoints(state, normalized.grid, start, goal)
    : normalized;
}

type Entry = {
  state: number;
  cost: number;
  steps: number;
  turns: number;
  estimate: number;
  estimatedSteps: number;
};

function precedes(a: Entry, b: Entry): boolean {
  return (
    a.estimate < b.estimate ||
    (a.estimate === b.estimate &&
      (a.estimatedSteps < b.estimatedSteps ||
        (a.estimatedSteps === b.estimatedSteps &&
          (a.turns < b.turns ||
            (a.turns === b.turns &&
              (a.steps > b.steps || (a.steps === b.steps && a.state < b.state)))))))
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
 * Four-neighbor A*: minimize cost, then steps, then turns. Manhattan distance
 * lower-bounds remaining cost and steps; zero lower-bounds remaining turns. Incoming heading is part of
 * each search state, since two visits to one cell can have different future turn costs.
 * Returns ordered path cells, including both endpoints, rather than the search's explored cells.
 */
export function findPath(input: PathSearchInput, budget?: PathSearchBudget): PathSearchResult {
  const { width, height, blocked, penalties, start, goal, startDirection, goalDirection } = input;
  if (
    !validPathGrid(input) ||
    !inside(start, width, height) ||
    !inside(goal, width, height) ||
    (startDirection !== undefined && !directions.includes(startDirection)) ||
    (goalDirection !== undefined && !directions.includes(goalDirection)) ||
    (budget !== undefined && (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0))
  )
    return { kind: 'invalid', message: 'Invalid path search grid, endpoints, or directions.' };
  const startCell = start.y * width + start.x;
  const goalCell = goal.y * width + goal.x;
  if (blocked[startCell] || blocked[goalCell]) return { kind: 'no-path' };
  if (startCell === goalCell)
    return { kind: 'found', cells: [{ ...start }], cost: 0, steps: 0, turns: 0 };
  if (budget?.remaining === 0) return { kind: 'budget-exhausted' };

  const initial = width * height * 4;
  const steps = new Int32Array(initial + 1).fill(-1);
  const costs = penalties ? new Float64Array(initial + 1) : undefined;
  const turns = new Int32Array(initial + 1);
  const parents = new Int32Array(initial + 1).fill(-1);
  const frontier = new Frontier();
  const distance = (x: number, y: number) => Math.abs(goal.x - x) + Math.abs(goal.y - y);
  steps[initial] = 0;
  frontier.push({
    state: initial,
    cost: 0,
    steps: 0,
    turns: 0,
    estimate: distance(start.x, start.y),
    estimatedSteps: distance(start.x, start.y),
  });

  for (let current = frontier.pop(); current; current = frontier.pop()) {
    if (
      steps[current.state] !== current.steps ||
      turns[current.state] !== current.turns ||
      (costs && costs[current.state] !== current.cost)
    )
      continue;
    if (budget) {
      if (budget.remaining === 0) return { kind: 'budget-exhausted' };
      budget.remaining--;
    }
    const cell = current.state === initial ? startCell : Math.floor(current.state / 4);
    if (cell === goalCell) {
      const cells: PathCell[] = [];
      for (let state = current.state; state !== -1; state = parents[state]) {
        const index = state === initial ? startCell : Math.floor(state / 4);
        cells.push({ x: index % width, y: Math.floor(index / width) });
      }
      return {
        kind: 'found',
        cells: cells.reverse(),
        cost: current.cost,
        steps: current.steps,
        turns: current.turns,
      };
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
      const nextCost = current.cost + 1 + (penalties?.[nextCell] ?? 0);
      if (!Number.isFinite(nextCost))
        return { kind: 'invalid', message: 'Path costs exceed the numeric range.' };
      const nextTurns =
        current.turns + Number(current.state !== initial && current.state % 4 !== direction);
      const previousCost = costs ? costs[state] : steps[state];
      if (
        steps[state] !== -1 &&
        (previousCost < nextCost ||
          (previousCost === nextCost &&
            (steps[state] < nextSteps ||
              (steps[state] === nextSteps && turns[state] <= nextTurns))))
      )
        continue;
      steps[state] = nextSteps;
      if (costs) costs[state] = nextCost;
      turns[state] = nextTurns;
      parents[state] = current.state;
      frontier.push({
        state,
        cost: nextCost,
        steps: nextSteps,
        turns: nextTurns,
        estimate: nextCost + distance(nextX, nextY),
        estimatedSteps: nextSteps + distance(nextX, nextY),
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
