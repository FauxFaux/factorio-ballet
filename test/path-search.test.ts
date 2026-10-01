import { describe, expect, it } from 'vitest';
import {
  findPath,
  MAX_PATH_SEARCH_CELLS,
  normalizeRoutingDebugState,
  solveRoutingDebugPath,
  type PathCell,
  type PathSearchInput,
} from '../src/compute/routing/path-search.ts';
import type { RoutingDebugState } from '../src/boot/url-handler.tsx';

function grid(width: number, height: number, start: PathCell, goal: PathCell): PathSearchInput {
  return { width, height, start, goal, blocked: new Uint8Array(width * height) };
}

// Independent exhaustive simple-path oracle for small grids, ordered by length then bends.
function enumerate(input: PathSearchInput): [number, number] | undefined {
  let best: [number, number] | undefined;
  const visited = new Set<number>();
  const walk = (x: number, y: number, steps: number, turns: number, heading: number) => {
    const cell = y * input.width + x;
    if (
      x < 0 ||
      x >= input.width ||
      y < 0 ||
      y >= input.height ||
      input.blocked[cell] ||
      visited.has(cell)
    )
      return;
    if (best && steps > best[0]) return;
    if (x === input.goal.x && y === input.goal.y) {
      if (!best || steps < best[0] || (steps === best[0] && turns < best[1])) best = [steps, turns];
      return;
    }
    visited.add(cell);
    [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ].forEach(([dx, dy], direction) =>
      walk(
        x + dx,
        y + dy,
        steps + 1,
        turns + Number(heading !== -1 && heading !== direction),
        direction,
      ),
    );
    visited.delete(cell);
  };
  walk(input.start.x, input.start.y, 0, 0, -1);
  return best;
}

function expectValidPath(input: PathSearchInput, cells: PathCell[]): void {
  expect(cells[0]).toEqual(input.start);
  expect(cells.at(-1)).toEqual(input.goal);
  cells.forEach((cell, index) => {
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.x).toBeLessThan(input.width);
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeLessThan(input.height);
    expect(input.blocked[cell.y * input.width + cell.x]).toBe(0);
    if (index) {
      const previous = cells[index - 1];
      expect(Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y)).toBe(1);
    }
  });
}

describe('findPath', () => {
  it('prefers an elbow over a staircase with the same Manhattan distance', () => {
    const input = grid(96, 64, { x: 0, y: 0 }, { x: 95, y: 63 });
    const result = findPath(input);
    expect(result).toMatchObject({ kind: 'found', steps: 158, turns: 1 });
    if (result.kind === 'found') expectValidPath(input, result.cells);
  });

  it('finds the shortest route with the fewest turns for every small obstacle grid', () => {
    for (let mask = 0; mask < 128; mask++) {
      const input = grid(3, 3, { x: 0, y: 0 }, { x: 2, y: 2 });
      for (let cell = 1; cell < 8; cell++) input.blocked[cell] = (mask >> (cell - 1)) & 1;
      const expected = enumerate(input);
      const actual = findPath(input);
      if (!expected) expect(actual).toEqual({ kind: 'no-path' });
      else {
        expect(actual).toMatchObject({ kind: 'found', steps: expected[0], turns: expected[1] });
        if (actual.kind === 'found') expectValidPath(input, actual.cells);
      }
    }
  });

  it('takes detours around walls', () => {
    const input = grid(5, 5, { x: 0, y: 0 }, { x: 4, y: 0 });
    for (let y = 0; y < 4; y++) input.blocked[y * 5 + 2] = 1;
    const result = findPath(input);
    expect(result).toMatchObject({ kind: 'found', steps: 12, turns: 2 });
    if (result.kind === 'found') expectValidPath(input, result.cells);
  });

  it('respects travel directions when departing and arriving', () => {
    const input = {
      ...grid(5, 4, { x: 1, y: 1 }, { x: 3, y: 1 }),
      startDirection: 'south' as const,
      goalDirection: 'north' as const,
    };
    const result = findPath(input);
    expect(result).toMatchObject({ kind: 'found', steps: 4, turns: 2 });
    if (result.kind === 'found') {
      expectValidPath(input, result.cells);
      expect(result.cells[1]).toEqual({ x: 1, y: 2 });
      expect(result.cells.at(-2)).toEqual({ x: 3, y: 2 });
    }
    expect(findPath({ ...input, startDirection: 'north', start: { x: 1, y: 0 } })).toEqual({
      kind: 'no-path',
    });
  });

  it('returns one cell for identical endpoints and no path for blocked endpoints', () => {
    const input = grid(1, 1, { x: 0, y: 0 }, { x: 0, y: 0 });
    expect(findPath(input)).toEqual({ kind: 'found', cells: [{ x: 0, y: 0 }], steps: 0, turns: 0 });
    input.blocked[0] = 1;
    expect(findPath(input)).toEqual({ kind: 'no-path' });
  });

  it('rejects malformed grids before allocating search storage', () => {
    const input = grid(2, 2, { x: 0, y: 0 }, { x: 1, y: 1 });
    for (const patch of [
      { width: 1.5 },
      { height: 0 },
      { width: MAX_PATH_SEARCH_CELLS + 1 },
      { blocked: new Uint8Array(3) },
      { start: { x: -1, y: 0 } },
      { goal: { x: 1, y: NaN } },
    ])
      expect(findPath({ ...input, ...patch })).toMatchObject({ kind: 'invalid' });
  });
});

const state: RoutingDebugState = {
  width: 6,
  height: 5,
  entities: [
    { kind: 'source', x: 0, y: 1, direction: 'east', item: 'iron', rate: 5 },
    { kind: 'sink', x: 5, y: 1, direction: 'east', item: 'iron', rate: 5 },
    { kind: 'source', x: 1, y: 0, direction: 'south', item: 'copper', rate: 1 },
  ],
  rectangles: [{ x: 2, y: 0, width: 2, height: 3 }],
};
const start = { x: 0, y: 1 };
const goal = { x: 5, y: 1 };

describe('normalizeRoutingDebugState', () => {
  it('rasterizes buildings and entity tiles while routing between adjacent connection tiles', () => {
    const normalized = normalizeRoutingDebugState(state, start, goal);
    expect(normalized.kind).toBe('ok');
    if (normalized.kind !== 'ok') return;
    const { input } = normalized;
    expect(input.blocked[6]).toBe(1);
    expect(input.blocked[11]).toBe(1);
    expect(input.blocked[1]).toBe(1);
    for (const y of [0, 1, 2]) for (const x of [2, 3]) expect(input.blocked[y * 6 + x]).toBe(1);
    expect(input.start).toEqual({ x: 1, y: 1 });
    expect(input.goal).toEqual({ x: 4, y: 1 });
    expect(input.startDirection).toBeUndefined();
    expect(input.goalDirection).toBeUndefined();
    const result = solveRoutingDebugPath(state, start, goal);
    expect(result).toMatchObject({ kind: 'found' });
    if (result.kind === 'found') expectValidPath(input, result.cells);
    expect(state.entities?.[0]).toMatchObject({ x: 0, y: 1 });
  });

  it.each([
    ['east', 1, 0],
    ['south', 0, 1],
    ['west', -1, 0],
    ['north', 0, -1],
  ] as const)('routes between %s-facing ports inside buildings', (direction, dx, dy) => {
    const source = { kind: 'source' as const, x: 4, y: 4, direction, item: 'iron', rate: 5 };
    const sink = { ...source, kind: 'sink' as const, x: 4 + 4 * dx, y: 4 + 4 * dy };
    const other = { ...source, x: 1, y: 5, item: 'copper' };
    const geometry: RoutingDebugState = {
      width: 9,
      height: 9,
      entities: [source, sink, other],
      rectangles: [source, sink, other].map(({ x, y }) => ({ x, y, width: 1, height: 1 })),
    };
    const result = solveRoutingDebugPath(geometry, source, sink);
    expect(result).toEqual({
      kind: 'found',
      steps: 2,
      turns: 0,
      cells: [1, 2, 3].map((distance) => ({ x: 4 + distance * dx, y: 4 + distance * dy })),
    });
  });

  it('supports a shared connection tile and rejects connections outside the grid', () => {
    const source = state.entities![0];
    const sink = { ...state.entities![1], x: 2 };
    expect(solveRoutingDebugPath({ entities: [source, sink] }, source, sink)).toEqual({
      kind: 'found',
      cells: [{ x: 1, y: 1 }],
      steps: 0,
      turns: 0,
    });
    const outward = { ...source, x: 0, y: 0, direction: 'north' as const };
    expect(solveRoutingDebugPath({ entities: [outward, sink] }, outward, sink)).toMatchObject({
      kind: 'invalid',
    });
  });

  it('supports empty state defaults and overlapping reserved rectangles', () => {
    const result = normalizeRoutingDebugState({}, start, goal);
    expect(result).toMatchObject({ kind: 'ok', input: { width: 96, height: 64 } });
    expect(
      normalizeRoutingDebugState(
        {
          rectangles: [
            { x: 2, y: 2, width: 2, height: 2 },
            { x: 3, y: 3, width: 2, height: 2 },
          ],
        },
        start,
        goal,
      ),
    ).toMatchObject({ kind: 'ok' });
  });

  it('rejects invalid geometry and endpoint reservations', () => {
    for (const patch of [
      { width: -1 },
      { height: Infinity },
      { rectangles: [{ x: 2, y: 2, width: 0, height: 1 }] },
      { rectangles: [{ x: 5, y: 2, width: 2, height: 1 }] },
      { rectangles: [{ x: 1, y: 1, width: 1, height: 1 }] },
      { entities: [state.entities![0], state.entities![0]] },
      { entities: [{ ...state.entities![0], rate: 0 }] },
      { entities: [{ ...state.entities![0], x: 0.5 }] },
      { entities: [{ ...state.entities![0], kind: 'sink' as const }] },
      { entities: [state.entities![0], { ...state.entities![1], item: 'copper' }] },
    ])
      expect(solveRoutingDebugPath({ ...state, ...patch }, start, goal)).toMatchObject({
        kind: 'invalid',
      });
    expect(normalizeRoutingDebugState({}, { x: 96, y: 0 }, goal)).toMatchObject({
      kind: 'invalid',
    });
    expect(
      normalizeRoutingDebugState({ rectangles: [{ ...start, width: 1, height: 1 }] }, start, goal),
    ).toMatchObject({ kind: 'invalid' });
  });
});
