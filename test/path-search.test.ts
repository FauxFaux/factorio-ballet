import { describe, expect, it } from 'vitest';
import {
  findPath,
  MAX_PATH_SEARCH_CELLS,
  normalizeRoutingDebugState,
  solveRoutingDebugPath,
  type PathCell,
  type PathDirection,
  type PathSearchInput,
  type UndergroundBeltSpan,
} from '../src/compute/routing/path-search.ts';
import type { RoutingDebugState } from '../src/boot/url-handler.tsx';

function grid(width: number, height: number, start: PathCell, goal: PathCell): PathSearchInput {
  return { width, height, start, goal, blocked: new Uint8Array(width * height) };
}

// Independent exhaustive simple-path oracle, ordered by cost, length, then bends.
function enumerate(input: PathSearchInput): [number, number, number] | undefined {
  let best: [number, number, number] | undefined;
  const visited = new Set<number>();
  const walk = (
    x: number,
    y: number,
    cost: number,
    steps: number,
    turns: number,
    heading: number,
  ) => {
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
    if (best && cost > best[0]) return;
    if (x === input.goal.x && y === input.goal.y) {
      if (
        !best ||
        cost < best[0] ||
        (cost === best[0] && (steps < best[1] || (steps === best[1] && turns < best[2])))
      )
        best = [cost, steps, turns];
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
        cost + 1 + (input.penalties?.[(y + dy) * input.width + x + dx] ?? 0),
        steps + 1,
        turns + Number(heading !== -1 && heading !== direction),
        direction,
      ),
    );
    visited.delete(cell);
  };
  walk(input.start.x, input.start.y, 0, 0, 0, -1);
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
        expect(actual).toMatchObject({
          kind: 'found',
          cost: expected[0],
          steps: expected[1],
          turns: expected[2],
        });
        if (actual.kind === 'found') expectValidPath(input, actual.cells);
      }
    }
  });

  it('minimizes weighted cost, then length and turns, against exhaustive small-grid paths', () => {
    for (let mask = 0; mask < 128; mask++) {
      const input = {
        ...grid(3, 3, { x: 0, y: 0 }, { x: 2, y: 2 }),
        penalties: Float64Array.from({ length: 9 }, (_, index) => ((index * 5 + mask) % 7) / 2),
      };
      for (let cell = 1; cell < 8; cell++) input.blocked[cell] = (mask >> (cell - 1)) & 1;
      const expected = enumerate(input);
      const actual = findPath(input);
      if (!expected) expect(actual).toEqual({ kind: 'no-path' });
      else {
        expect(actual).toMatchObject({
          kind: 'found',
          cost: expected[0],
          steps: expected[1],
          turns: expected[2],
        });
        if (actual.kind === 'found') expectValidPath(input, actual.cells);
      }
    }
  });

  it('shares a deterministic expansion budget and distinguishes exhaustion from no path', () => {
    const input = grid(5, 5, { x: 0, y: 0 }, { x: 4, y: 4 });
    const budget = { remaining: 1 };
    expect(findPath(input, budget)).toEqual({ kind: 'budget-exhausted' });
    expect(budget.remaining).toBe(0);
    expect(findPath(input, budget)).toEqual({ kind: 'budget-exhausted' });
    input.blocked[1] = input.blocked[5] = 1;
    expect(findPath(input, { remaining: 1 })).toEqual({ kind: 'no-path' });
  });

  it('rejects overflowing path costs rather than returning an infinite score', () => {
    const input = {
      ...grid(3, 1, { x: 0, y: 0 }, { x: 2, y: 0 }),
      penalties: new Float64Array(3).fill(Number.MAX_VALUE),
    };
    expect(findPath(input)).toMatchObject({ kind: 'invalid' });
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
    expect(findPath(input)).toEqual({
      kind: 'found',
      cells: [{ x: 0, y: 0 }],
      cost: 0,
      steps: 0,
      turns: 0,
    });
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
      { penalties: new Float64Array(3) },
      { penalties: new Float64Array(4).fill(-1) },
      { penalties: new Float64Array(4).fill(Infinity) },
      { penalties: new Float64Array(4).fill(NaN) },
    ])
      expect(findPath({ ...input, ...patch })).toMatchObject({ kind: 'invalid' });
  });
});

function expectValidUndergroundPath(
  input: PathSearchInput,
  result: Extract<ReturnType<typeof findPath>, { kind: 'found' }>,
): void {
  expect(result.cells[0]).toEqual(input.start);
  expect(result.cells.at(-1)).toEqual(input.goal);
  expect(new Set(result.cells.map(({ x, y }) => y * input.width + x)).size).toBe(
    result.cells.length,
  );
  const spans = result.undergroundBelts ?? [];
  let steps = 0;
  for (const [index, cell] of result.cells.entries()) {
    expect(input.blocked[cell.y * input.width + cell.x]).toBe(0);
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.x).toBeLessThan(input.width);
    expect(cell.y).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeLessThan(input.height);
    if (!index) continue;
    const previous = result.cells[index - 1];
    steps += Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y);
    if (Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y) > 1)
      expect(spans).toContainEqual({ entry: previous, exit: cell });
  }
  for (const span of spans) {
    const entry = result.cells.findIndex(
      (cell) => cell.x === span.entry.x && cell.y === span.entry.y,
    );
    expect(result.cells[entry + 1]).toEqual(span.exit);
    const alignment = result.cells[entry - 1];
    const decision = result.cells[entry + 2];
    const dx = Math.sign(span.exit.x - span.entry.x);
    const dy = Math.sign(span.exit.y - span.entry.y);
    expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
    expect(span.entry).toEqual({ x: alignment.x + dx, y: alignment.y + dy });
    expect(decision).toEqual({ x: span.exit.x + dx, y: span.exit.y + dy });
    expect(
      Math.abs(span.exit.x - span.entry.x) + Math.abs(span.exit.y - span.entry.y) - 1,
    ).toBeLessThanOrEqual(input.undergroundBeltReach!);
  }
  const all = [...(input.undergroundBelts ?? []), ...spans];
  for (let first = 0; first < all.length; first++) {
    const a = all[first];
    for (const b of all.slice(first + 1)) {
      for (const endpoint of [a.entry, a.exit])
        expect([b.entry, b.exit]).not.toContainEqual(endpoint);
      if (a.entry.y === a.exit.y && b.entry.y === b.exit.y && a.entry.y === b.entry.y)
        expect(
          Math.max(Math.min(a.entry.x, a.exit.x), Math.min(b.entry.x, b.exit.x)),
        ).toBeGreaterThan(Math.min(Math.max(a.entry.x, a.exit.x), Math.max(b.entry.x, b.exit.x)));
      if (a.entry.x === a.exit.x && b.entry.x === b.exit.x && a.entry.x === b.entry.x)
        expect(
          Math.max(Math.min(a.entry.y, a.exit.y), Math.min(b.entry.y, b.exit.y)),
        ).toBeGreaterThan(Math.min(Math.max(a.entry.y, a.exit.y), Math.max(b.entry.y, b.exit.y)));
    }
  }
  expect(result.steps).toBe(steps);
  expect(result.cost).toBe(
    steps +
      result.cells
        .slice(1)
        .reduce((cost, { x, y }) => cost + (input.penalties?.[y * input.width + x] ?? 0), 0),
  );
}

describe('findPath underground belts', () => {
  it.each([
    ['east', { x: 0, y: 0 }, { x: 6, y: 0 }, 7, 1],
    ['west', { x: 6, y: 0 }, { x: 0, y: 0 }, 7, 1],
    ['south', { x: 0, y: 0 }, { x: 0, y: 6 }, 1, 7],
    ['north', { x: 0, y: 6 }, { x: 0, y: 0 }, 1, 7],
  ] as const)(
    'tunnels beneath obstacles travelling %s',
    (direction, start, goal, width, height) => {
      const input = {
        ...grid(width, height, start, goal),
        undergroundBeltReach: 3,
        startDirection: direction,
        goalDirection: direction,
      };
      input.blocked[3] = input.blocked[4] = 1;
      expect(findPath({ ...input, undergroundBeltReach: undefined })).toEqual({ kind: 'no-path' });
      const result = findPath(input);
      expect(result).toMatchObject({ kind: 'found', cost: 6, steps: 6, turns: 0 });
      if (result.kind !== 'found') return;
      expect(result.undergroundBelts).toHaveLength(1);
      expectValidUndergroundPath(input, result);
      expect(findPath(input)).toEqual(result);
    },
  );

  it('counts only hidden cells against the configurable reach', () => {
    const input = { ...grid(7, 1, { x: 0, y: 0 }, { x: 6, y: 0 }), undergroundBeltReach: 2 };
    input.blocked[3] = input.blocked[4] = 1;
    expect(findPath({ ...input, undergroundBeltReach: 1 })).toEqual({ kind: 'no-path' });
    expect(findPath(input)).toMatchObject({
      kind: 'found',
      undergroundBelts: [{ entry: { x: 2, y: 0 }, exit: { x: 5, y: 0 } }],
    });
  });

  it('prefers surface belts over unnecessary zero-hidden-tile pairs', () => {
    const input = { ...grid(4, 1, { x: 0, y: 0 }, { x: 3, y: 0 }), undergroundBeltReach: 0 };
    const result = findPath(input);
    expect(result).toMatchObject({
      kind: 'found',
      undergroundBelts: [],
    });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
    expect(
      findPath({ ...grid(3, 1, { x: 0, y: 0 }, { x: 2, y: 0 }), undergroundBeltReach: 0 }),
    ).toMatchObject({ kind: 'found', undergroundBelts: [] });
  });

  it('accepts existing zero-hidden-tile pairs without making them an obstacle underground', () => {
    const input = {
      ...grid(4, 2, { x: 0, y: 1 }, { x: 3, y: 1 }),
      undergroundBeltReach: 0,
      undergroundBelts: [{ entry: { x: 1, y: 0 }, exit: { x: 2, y: 0 } }],
    };
    expect(findPath(input)).toMatchObject({ kind: 'found', steps: 3, undergroundBelts: [] });
  });

  it('requires clear entry, exit, and a straight step beyond the exit', () => {
    const input = { ...grid(7, 1, { x: 0, y: 0 }, { x: 6, y: 0 }), undergroundBeltReach: 12 };
    for (const obstacles of [[1], [5], [4, 5]]) {
      input.blocked.fill(0);
      for (const cell of obstacles) input.blocked[cell] = 1;
      expect(findPath(input)).toEqual({ kind: 'no-path' });
    }
    const short = { ...grid(5, 1, { x: 0, y: 0 }, { x: 4, y: 0 }), undergroundBeltReach: 12 };
    short.blocked[2] = short.blocked[3] = 1;
    expect(findPath(short)).toEqual({ kind: 'no-path' });
  });

  it('turns on alignment and decision cells while keeping the tunnel straight', () => {
    const input = { ...grid(3, 5, { x: 0, y: 0 }, { x: 2, y: 4 }), undergroundBeltReach: 2 };
    input.blocked.fill(1);
    for (const cell of [0, 1, 4, 10, 13, 14]) input.blocked[cell] = 0;
    const result = findPath(input);
    expect(result).toMatchObject({
      kind: 'found',
      steps: 6,
      turns: 2,
      undergroundBelts: [{ entry: { x: 1, y: 1 }, exit: { x: 1, y: 3 } }],
    });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
    input.blocked[13] = 1;
    expect(findPath(input)).toEqual({ kind: 'no-path' });
  });

  it('respects departure and arrival directions for tunnel moves', () => {
    const input = { ...grid(7, 1, { x: 0, y: 0 }, { x: 6, y: 0 }), undergroundBeltReach: 3 };
    input.blocked[3] = input.blocked[4] = 1;
    expect(findPath({ ...input, startDirection: 'west' })).toEqual({ kind: 'no-path' });
    expect(findPath({ ...input, goalDirection: 'west' })).toEqual({ kind: 'no-path' });
  });

  it('charges distance and surface penalties, ignoring underground obstacle penalties', () => {
    const input = {
      ...grid(7, 1, { x: 0, y: 0 }, { x: 6, y: 0 }),
      undergroundBeltReach: 3,
      penalties: Float64Array.from([0, 2, 100, 100, 100, 3, 4]),
    };
    input.blocked[3] = input.blocked[4] = 1;
    const result = findPath(input);
    expect(result).toMatchObject({ kind: 'found', cost: 15, steps: 6, turns: 0 });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
  });

  it('allows perpendicular underground crossings and surface travel over hidden spans', () => {
    const input = {
      ...grid(7, 5, { x: 0, y: 2 }, { x: 6, y: 2 }),
      undergroundBeltReach: 3,
      undergroundBelts: [{ entry: { x: 3, y: 0 }, exit: { x: 3, y: 4 } }],
    };
    input.blocked.fill(1);
    input.blocked.fill(0, 14, 21);
    const surface = findPath({ ...input, undergroundBeltReach: undefined });
    expect(surface).toMatchObject({ kind: 'found', steps: 6 });
    input.blocked[17] = input.blocked[18] = 1;
    const result = findPath(input);
    expect(result).toMatchObject({ kind: 'found', steps: 6 });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
    expect(input.blocked[3]).toBe(1);
  });

  it.each([
    [
      { x: 3, y: 0 },
      { x: 7, y: 0 },
    ], // interleaved
    [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ], // nested
    [
      { x: 4, y: 0 },
      { x: 3, y: 0 },
    ], // opposite direction
    [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
    ], // containing
  ])('rejects parallel overlap with a reserved pair %j -> %j', (entry, exit) => {
    const input = {
      ...grid(8, 1, { x: 1, y: 0 }, { x: 6, y: 0 }),
      undergroundBeltReach: 12,
      undergroundBelts: [{ entry, exit }],
    };
    input.blocked[3] = input.blocked[4] = 1;
    expect(findPath(input)).toEqual({ kind: 'no-path' });
  });

  it('permits successive nonoverlapping pairs on the same line', () => {
    const input = { ...grid(10, 1, { x: 0, y: 0 }, { x: 9, y: 0 }), undergroundBeltReach: 1 };
    input.blocked[2] = input.blocked[7] = 1;
    const result = findPath(input);
    expect(result).toMatchObject({ kind: 'found', steps: 9, turns: 0 });
    if (result.kind === 'found') {
      expect(result.undergroundBelts).toHaveLength(2);
      expectValidUndergroundPath(input, result);
    }
  });

  it('permits parallel tunnels on different rows', () => {
    const input = {
      ...grid(7, 2, { x: 0, y: 1 }, { x: 6, y: 1 }),
      undergroundBeltReach: 3,
      undergroundBelts: [{ entry: { x: 1, y: 0 }, exit: { x: 5, y: 0 } }],
    };
    input.blocked.fill(1, 0, 7);
    input.blocked[10] = input.blocked[11] = 1;
    const result = findPath(input);
    expect(result).toMatchObject({ kind: 'found', steps: 6, turns: 0 });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
  });

  it('reserves existing endpoints without changing the supplied occupancy', () => {
    const input = {
      ...grid(4, 1, { x: 0, y: 0 }, { x: 3, y: 0 }),
      undergroundBelts: [{ entry: { x: 1, y: 0 }, exit: { x: 2, y: 0 } }],
    };
    expect(findPath(input)).toEqual({ kind: 'no-path' });
    expect([...input.blocked]).toEqual([0, 0, 0, 0]);
    expect(findPath({ ...input, start: { x: 1, y: 0 } })).toEqual({ kind: 'no-path' });
  });

  it('supports identical endpoints, budgets, and overflowing costs', () => {
    const input = { ...grid(7, 1, { x: 0, y: 0 }, { x: 6, y: 0 }), undergroundBeltReach: 3 };
    const budget = { remaining: 1 };
    expect(findPath(input, budget)).toEqual({ kind: 'budget-exhausted' });
    expect(budget.remaining).toBe(0);
    expect(findPath({ ...input, goal: input.start }, budget)).toMatchObject({
      kind: 'found',
      cells: [input.start],
      undergroundBelts: [],
      steps: 0,
    });
    expect(
      findPath({ ...input, penalties: new Float64Array(7).fill(Number.MAX_VALUE) }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('avoids reversing through its own tunnels while retaining the valid detour', () => {
    const input = {
      ...grid(9, 6, { x: 2, y: 3 }, { x: 0, y: 3 }),
      undergroundBeltReach: 5,
      startDirection: 'east' as const,
      goalDirection: 'west' as const,
    };
    input.blocked.fill(1);
    // A ten-step route reversing through overlapping tunnels has only one turn. The valid
    // alternative takes ten steps and four turns around the top corridor instead.
    for (const cell of [
      27, 28, 29, 30, 32, 33, 34, 35, 42, 44, 51, 52, 53, 21, 12, 3, 2, 1, 10, 19,
    ])
      input.blocked[cell] = 0;
    const result = findPath(input, { remaining: 5_000 });
    expect(result).toMatchObject({ kind: 'found', steps: 10, turns: 4, undergroundBelts: [] });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
    expect(findPath(input, { remaining: 1 })).toEqual({ kind: 'budget-exhausted' });
  });

  it('rejects a route whose second tunnel overlaps its own first tunnel', () => {
    const input = {
      ...grid(9, 4, { x: 2, y: 1 }, { x: 0, y: 1 }),
      undergroundBeltReach: 5,
      startDirection: 'east' as const,
      goalDirection: 'west' as const,
    };
    input.blocked.fill(1);
    for (const cell of [9, 10, 11, 12, 14, 15, 16, 17, 24, 26, 33, 34, 35]) input.blocked[cell] = 0;
    // East through (3,1)->(7,1), around the bottom loop, then west through (5,1)->(1,1)
    // would reach the goal, but the parallel spans overlap. Shorter first spans reuse surface cells.
    expect(findPath(input)).toEqual({ kind: 'no-path' });
  });

  it('replans overlapping tunnels to find a longer collision-free optimum', () => {
    const input = {
      ...grid(9, 11, { x: 2, y: 8 }, { x: 0, y: 8 }),
      undergroundBeltReach: 5,
      startDirection: 'east' as const,
      goalDirection: 'west' as const,
    };
    input.blocked.fill(1);
    for (const cell of [72, 73, 74, 75, 77, 78, 79, 80, 87, 89, 96, 97, 98, 1, 2, 3])
      input.blocked[cell] = 0;
    for (let y = 1; y < 8; y++) input.blocked[y * 9 + 1] = input.blocked[y * 9 + 3] = 0;
    // The relaxed 18-step path loops below the first tunnel, then overlaps it travelling west.
    // The valid optimum takes the 20-step top corridor. It has the same four turns and no pairs.
    const result = findPath(input, { remaining: 1_000 });
    expect(result).toMatchObject({ kind: 'found', steps: 20, turns: 4, undergroundBelts: [] });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
  });

  it('turns left, forward, left, left to tunnel under its earlier surface path', () => {
    const input = {
      ...grid(4, 5, { x: 2, y: 2 }, { x: 3, y: 4 }),
      undergroundBeltReach: 1,
      startDirection: 'east' as const,
      goalDirection: 'east' as const,
    };
    input.blocked.fill(1);
    for (const cell of [10, 11, 7, 3, 2, 6, 14, 18, 19]) input.blocked[cell] = 0;
    const result = findPath(input);
    expect(result).toMatchObject({
      kind: 'found',
      steps: 9,
      turns: 4,
      undergroundBelts: [{ entry: { x: 2, y: 1 }, exit: { x: 2, y: 3 } }],
    });
    if (result.kind === 'found') expectValidUndergroundPath(input, result);
  });

  it('proves a self-conflicting dead end without enumerating placement histories', () => {
    const input = {
      ...grid(16, 12, { x: 12, y: 0 }, { x: 0, y: 5 }),
      undergroundBeltReach: 5,
    };
    input.blocked = Uint8Array.from(
      [
        '0110011010010001',
        '0010011110101000',
        '1011101000000001',
        '0100100010100100',
        '0100100011100100',
        '0100001100001001',
        '1100010100000000',
        '0000001100101001',
        '0001000000000000',
        '1010110000100000',
        '1011100001000001',
        '0001100001110010',
      ].join(''),
      Number,
    );
    // The history fallback exhausted 20,000 states on this grid. Count work, not wall time.
    expect(findPath(input, { remaining: 500 })).toEqual({ kind: 'no-path' });
    expect(findPath(input, { remaining: 100 })).toEqual({ kind: 'budget-exhausted' });
  });

  it('matches exhaustive placement search on small weighted obstacle grids', () => {
    // Independent simple-placement oracle: reserve surfaced cells and rasterize each tunnel axis.
    const oracle = (input: PathSearchInput): [number, number, number, number] | undefined => {
      let best: [number, number, number, number] | undefined;
      const visited = new Set<number>([input.start.y * input.width + input.start.x]);
      const tunnels: { axis: number; cells: Set<number> }[] = [];
      const walk = (
        x: number,
        y: number,
        heading: number,
        cost: number,
        steps: number,
        turns: number,
      ) => {
        if (best && cost > best[0]) return;
        if (x === input.goal.x && y === input.goal.y) {
          const score: [number, number, number, number] = [cost, steps, turns, tunnels.length];
          if (
            !best ||
            cost < best[0] ||
            (cost === best[0] &&
              (steps < best[1] ||
                (steps === best[1] &&
                  (turns < best[2] || (turns === best[2] && tunnels.length < best[3])))))
          )
            best = score;
          return;
        }
        for (const [direction, [dx, dy]] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ].entries()) {
          const directions: PathDirection[] = ['east', 'south', 'west', 'north'];
          if (steps === 0 && input.startDirection && directions[direction] !== input.startDirection)
            continue;
          for (let hidden = -1; hidden <= input.undergroundBeltReach!; hidden++) {
            const length = hidden === -1 ? 1 : hidden + 3;
            const points = hidden === -1 ? [1] : [1, length - 1, length];
            const positions = points.map((distance) => ({
              x: x + distance * dx,
              y: y + distance * dy,
            }));
            if (
              positions.some(
                (point) =>
                  point.x < 0 || point.x >= input.width || point.y < 0 || point.y >= input.height,
              )
            )
              continue;
            const cells = positions.map((point) => point.y * input.width + point.x);
            if (cells.some((cell) => visited.has(cell) || input.blocked[cell])) continue;
            if (cells.slice(0, -1).includes(input.goal.y * input.width + input.goal.x)) continue;
            const last = positions.at(-1)!;
            if (
              last.x === input.goal.x &&
              last.y === input.goal.y &&
              input.goalDirection &&
              directions[direction] !== input.goalDirection
            )
              continue;
            const tunnel = { axis: direction % 2, cells: new Set<number>() };
            if (hidden !== -1) {
              for (let distance = 1; distance < length; distance++)
                tunnel.cells.add((y + distance * dy) * input.width + x + distance * dx);
              if (
                tunnels.some(
                  (other) =>
                    other.axis === tunnel.axis &&
                    [...other.cells].some((cell) => tunnel.cells.has(cell)),
                )
              )
                continue;
              tunnels.push(tunnel);
            }
            cells.forEach((cell) => visited.add(cell));
            walk(
              last.x,
              last.y,
              direction,
              cost + length + cells.reduce((sum, cell) => sum + input.penalties![cell], 0),
              steps + length,
              turns + Number(heading !== -1 && heading !== direction),
            );
            cells.forEach((cell) => visited.delete(cell));
            if (hidden !== -1) tunnels.pop();
          }
        }
      };
      walk(input.start.x, input.start.y, -1, 0, 0, 0);
      return best;
    };
    const inputs: PathSearchInput[] = [];
    for (const [width, height, start, goal] of [
      [4, 2, { x: 0, y: 0 }, { x: 3, y: 1 }],
      [4, 3, { x: 1, y: 1 }, { x: 0, y: 1 }],
      [5, 3, { x: 1, y: 1 }, { x: 3, y: 1 }],
    ] as const) {
      for (let mask = 0; mask < 128; mask++) {
        const directions: PathDirection[] = ['east', 'south', 'west', 'north'];
        const input: PathSearchInput = {
          ...grid(width, height, start, goal),
          undergroundBeltReach: 2,
          penalties: Float64Array.from(
            { length: width * height },
            (_, cell) => (cell * 3 + mask) % 5,
          ),
          startDirection: mask % 3 ? undefined : directions[mask % 4],
          goalDirection: mask % 5 ? undefined : directions[(mask >> 2) % 4],
        };
        for (let cell = 0; cell < width * height; cell++)
          input.blocked[cell] = (mask >> (cell % 7)) & 1;
        input.blocked[start.y * width + start.x] = input.blocked[goal.y * width + goal.x] = 0;
        inputs.push(input);
      }
    }
    for (const input of inputs) {
      const expected = oracle(input);
      const actual = findPath(input);
      if (!expected) expect(actual).toEqual({ kind: 'no-path' });
      else {
        expect(actual).toMatchObject({
          kind: 'found',
          cost: expected[0],
          steps: expected[1],
          turns: expected[2],
        });
        if (actual.kind === 'found') {
          expect(actual.undergroundBelts).toHaveLength(expected[3]);
          expectValidUndergroundPath(input, actual);
        }
      }
    }
  });

  it('excludes forbidden pairs in either travel direction while preserving alternative spans', () => {
    const input = { ...grid(7, 1, { x: 0, y: 0 }, { x: 6, y: 0 }), undergroundBeltReach: 3 };
    input.blocked[3] = input.blocked[4] = 1;
    for (const [entry, exit] of [
      [1, 5],
      [5, 1],
    ]) {
      const forbiddenUndergroundBelts = [{ entry: { x: entry, y: 0 }, exit: { x: exit, y: 0 } }];
      expect(findPath({ ...input, forbiddenUndergroundBelts })).toMatchObject({
        kind: 'found',
        undergroundBelts: [{ entry: { x: 2, y: 0 }, exit: { x: 5, y: 0 } }],
      });
      forbiddenUndergroundBelts.push({ entry: { x: 2, y: 0 }, exit: { x: 5, y: 0 } });
      expect(findPath({ ...input, forbiddenUndergroundBelts })).toEqual({ kind: 'no-path' });
    }
    expect(
      findPath({
        ...input,
        forbiddenUndergroundBelts: [{ entry: { x: 1, y: 0 }, exit: { x: 1, y: 1 } }],
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('validates reach and reserved tunnel geometry', () => {
    const input = grid(8, 8, { x: 0, y: 0 }, { x: 7, y: 7 });
    for (const undergroundBeltReach of [-1, 1.5, Infinity, NaN])
      expect(findPath({ ...input, undergroundBeltReach })).toMatchObject({ kind: 'invalid' });
    const span = (a: number, b: number): UndergroundBeltSpan => ({
      entry: { x: a, y: 1 },
      exit: { x: b, y: 1 },
    });
    for (const undergroundBelts of [
      [{ entry: { x: 1, y: 1 }, exit: { x: 2, y: 2 } }],
      [span(1, 1)],
      [span(-1, 2)],
      [span(1, 8)],
      [span(1.5, 2)],
      [span(1, 4), span(3, 6)],
      [span(1, 6), span(3, 4)],
      [span(1, 3), span(3, 6)],
    ])
      expect(findPath({ ...input, undergroundBelts })).toMatchObject({ kind: 'invalid' });
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
      cost: 2,
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
      cost: 0,
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
