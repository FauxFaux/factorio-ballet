import { describe, expect, it } from 'vitest';
import { solveConflictRouting } from '../../../src/compute/routing/conflict-search.ts';
import { findPath } from '../../../src/compute/routing/path-search.ts';
import type { RoutingInput, RoutingResult } from '../../../src/compute/routing/types.ts';

function obstacleDetours(sourceX = 23, transpose = false): RoutingInput {
  const width = 64;
  const height = 32;
  const blocked = new Uint8Array(width * height);
  for (let y = 0; y < 19; y++) for (let x = 28; x < 32; x++) blocked[y * width + x] = 1;
  const routes = [10, 15, 5].map((y, index) => {
    blocked[y * width + sourceX] = blocked[y * width + 36] = 1;
    return {
      id: String(index + 1),
      start: { x: sourceX + 1, y },
      goal: { x: 35, y },
    };
  });
  if (!transpose) return { width, height, blocked, routes };
  const rotated = new Uint8Array(blocked.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rotated[x * height + y] = blocked[y * width + x];
  return {
    width: height,
    height: width,
    blocked: rotated,
    routes: routes.map(({ id, start, goal }) => ({
      id,
      start: { x: start.y, y: start.x },
      goal: { x: goal.y, y: goal.x },
    })),
  };
}

function crossing(): RoutingInput {
  return {
    width: 7,
    height: 7,
    blocked: new Uint8Array(49),
    routes: [
      { id: 'a', start: { x: 1, y: 3 }, goal: { x: 5, y: 3 } },
      { id: 'b', start: { x: 3, y: 1 }, goal: { x: 3, y: 5 } },
    ],
  };
}

function expectValid(input: RoutingInput, result: RoutingResult): void {
  expect(result.kind).toBe('found');
  if (result.kind !== 'found') return;
  expect(result.routes).toHaveLength(input.routes.length);
  const occupied = new Set<number>();
  let steps = 0;
  let turns = 0;
  let cost = 0;
  for (const path of result.routes) {
    const request = input.routes.find(({ id }) => id === path.id)!;
    expect(path.cells[0]).toEqual(request.start);
    expect(path.cells.at(-1)).toEqual(request.goal);
    expect(path.steps).toBe(path.cells.length - 1);
    let previousHeading: string | undefined;
    let pathTurns = 0;
    let pathCost = 0;
    for (const [index, cell] of path.cells.entries()) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(input.width);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThan(input.height);
      const key = cell.y * input.width + cell.x;
      expect(input.blocked[key]).toBe(0);
      expect(occupied.has(key)).toBe(false);
      occupied.add(key);
      if (index) {
        const previous = path.cells[index - 1];
        const dx = cell.x - previous.x;
        const dy = cell.y - previous.y;
        expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
        const heading = `${dx},${dy}`;
        pathTurns += Number(previousHeading !== undefined && previousHeading !== heading);
        previousHeading = heading;
        pathCost += 1 + (input.penalties?.[key] ?? 0);
      }
    }
    expect(path.turns).toBe(pathTurns);
    expect(path.cost).toBeCloseTo(pathCost);
    steps += path.steps;
    turns += path.turns;
    cost += pathCost;
  }
  expect(result.steps).toBe(steps);
  expect(result.turns).toBe(turns);
  expect(result.cost).toBeCloseTo(cost);
  expect(result.diagnostics.remainingConflicts).toBe(0);
}

// Enumerate complete simple paths independently of A* and CBS, reserving them recursively.
function feasible(input: RoutingInput): boolean {
  const used = new Set<number>();
  const route = (index: number): boolean => {
    if (index === input.routes.length) return true;
    const { start, goal } = input.routes[index];
    const walk = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= input.width || y >= input.height) return false;
      const cell = y * input.width + x;
      if (input.blocked[cell] || used.has(cell)) return false;
      used.add(cell);
      const solved =
        x === goal.x && y === goal.y
          ? route(index + 1)
          : walk(x + 1, y) || walk(x, y + 1) || walk(x - 1, y) || walk(x, y - 1);
      used.delete(cell);
      return solved;
    };
    return walk(start.x, start.y);
  };
  return route(0);
}

describe('solveConflictRouting', () => {
  it('routes nested detours around an obstacle without exploring cell-by-cell conflicts', () => {
    const input = obstacleDetours();
    const result = solveConflictRouting(input);
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.steps).toBe(101);
      expect(result.diagnostics.expandedNodes).toBe(0);
      expect(result.diagnostics.pathStates).toBeLessThan(25_000);
      expect(result.diagnostics.reservationPasses).toBeGreaterThan(0);
    }
    // Moving the sources in free space and transposing the layout should remain inexpensive.
    for (const sourceX of [20, 23, 25])
      for (const transpose of [false, true]) {
        const variant = obstacleDetours(sourceX, transpose);
        const solved = solveConflictRouting(variant);
        expectValid(variant, solved);
        if (solved.kind === 'found') expect(solved.diagnostics.pathStates).toBeLessThan(50_000);
        expect(solveConflictRouting({ ...variant, routes: [...variant.routes].reverse() })).toEqual(
          solved,
        );
      }
  });

  it('keeps a valid reservation layout when a later priority order runs out of work', () => {
    const input = obstacleDetours();
    const result = solveConflictRouting(input, {
      maxReservationStates: 3_000,
      maxPathStates: 20_000,
    });
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.diagnostics.reservationPasses).toBeGreaterThan(1);
      expect(result.diagnostics.expandedNodes).toBe(0);
      expect(result.diagnostics.pathStates).toBeLessThan(5_000);
    }
  });

  it('leaves work for conflict search when the reservation allowance is exhausted', () => {
    const input = crossing();
    const result = solveConflictRouting(input, { maxReservationStates: 1, maxPathStates: 1_000 });
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.diagnostics.reservationPasses).toBe(1);
      expect(result.diagnostics.expandedNodes).toBeGreaterThan(0);
      expect(result.diagnostics.pathStates).toBeLessThanOrEqual(1_000);
    }
  });

  it('routes four pairs in free space that exceeded the former default search budget', () => {
    const input: RoutingInput = {
      width: 32,
      height: 24,
      blocked: new Uint8Array(32 * 24),
      routes: [
        { id: 'r0', start: { x: 19, y: 13 }, goal: { x: 17, y: 3 } },
        { id: 'r1', start: { x: 13, y: 13 }, goal: { x: 28, y: 8 } },
        { id: 'r2', start: { x: 23, y: 7 }, goal: { x: 27, y: 20 } },
        { id: 'r3', start: { x: 14, y: 10 }, goal: { x: 11, y: 2 } },
      ],
    };
    expect(
      solveConflictRouting(input, {
        maxPathStates: 200_000,
        maxNodes: 256,
        maxReservationStates: 0,
      }).kind,
    ).toBe('budget-exhausted');
    const result = solveConflictRouting(input);
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.diagnostics.expandedNodes).toBe(0);
      expect(result.diagnostics.pathStates).toBeLessThan(200_000);
    }
  });

  it('reroutes intersecting independent shortest paths into a complete disjoint layout', () => {
    const input = crossing();
    const result = solveConflictRouting(input);
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.steps).toBe(14);
      expect(result.diagnostics.reservationPasses).toBeGreaterThan(0);
    }
  });

  it('finds a layout that greedy routing misses in both possible pair orders', () => {
    const input = crossing();
    for (const [x, y] of [
      [2, 0],
      [4, 1],
      [5, 1],
      [1, 2],
      [6, 2],
      [4, 3],
      [6, 3],
      [1, 5],
      [2, 5],
      [0, 6],
      [2, 6],
    ])
      input.blocked[y * input.width + x] = 1;
    for (const [first, second] of [
      [0, 1],
      [1, 0],
    ]) {
      const blocked = input.blocked.slice();
      for (const point of [input.routes[second].start, input.routes[second].goal])
        blocked[point.y * input.width + point.x] = 1;
      const initial = findPath({ ...input, blocked, ...input.routes[first] });
      expect(initial.kind).toBe('found');
      if (initial.kind !== 'found') continue;
      for (const point of [input.routes[second].start, input.routes[second].goal])
        blocked[point.y * input.width + point.x] = 0;
      for (const point of initial.cells) blocked[point.y * input.width + point.x] = 1;
      expect(findPath({ ...input, blocked, ...input.routes[second] }).kind).toBe('no-path');
    }
    const result = solveConflictRouting(input);
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.diagnostics.reservationPasses).toBeGreaterThan(0);
      expect(result.diagnostics.expandedNodes).toBeGreaterThan(0);
    }
  });

  it('matches exhaustive feasibility for every four-terminal layout on a 3 by 3 grid', () => {
    let cases = 0;
    for (let a = 0; a < 9; a++)
      for (let b = a + 1; b < 9; b++)
        for (let c = b + 1; c < 9; c++)
          for (let d = c + 1; d < 9; d++) {
            const point = (cell: number) => ({ x: cell % 3, y: Math.floor(cell / 3) });
            for (const [end, otherStart] of [
              [b, c],
              [c, b],
              [d, b],
            ]) {
              const otherEnd = [b, c, d].find((cell) => cell !== end && cell !== otherStart)!;
              const input: RoutingInput = {
                width: 3,
                height: 3,
                blocked: new Uint8Array(9),
                routes: [
                  { id: 'a', start: point(a), goal: point(end) },
                  { id: 'b', start: point(otherStart), goal: point(otherEnd) },
                ],
              };
              // Repeat with one obstacle, leaving the terminals free.
              const obstacle = [0, 1, 2, 3, 4, 5, 6, 7, 8].find(
                (cell) => ![a, b, c, d].includes(cell),
              )!;
              for (const block of [false, true]) {
                input.blocked[obstacle] = Number(block);
                const expected = feasible(input);
                const result = solveConflictRouting(input, {
                  maxNodes: 10_000,
                  maxPathStates: 1_000_000,
                });
                expect(result.kind, JSON.stringify(input.routes)).toBe(
                  expected ? 'found' : 'no-solution',
                );
                if (expected) expectValid(input, result);
                cases++;
              }
            }
          }
    expect(cases).toBe(756);
  });

  it('proves failure when individually routable pairs compete for an unavoidable cell', () => {
    const input: RoutingInput = {
      width: 3,
      height: 3,
      blocked: new Uint8Array(9),
      routes: [
        { id: 'horizontal', start: { x: 0, y: 1 }, goal: { x: 2, y: 1 } },
        { id: 'vertical', start: { x: 1, y: 0 }, goal: { x: 1, y: 2 } },
      ],
    };
    expect(solveConflictRouting(input)).toMatchObject({
      kind: 'no-solution',
      diagnostics: { expandedNodes: 1 },
    });
  });

  it('reserves all other route endpoints before routing, including zero-length routes', () => {
    const input: RoutingInput = {
      width: 5,
      height: 3,
      blocked: new Uint8Array(15),
      routes: [
        { id: 'a', start: { x: 0, y: 0 }, goal: { x: 4, y: 0 } },
        { id: 'b', start: { x: 2, y: 0 }, goal: { x: 2, y: 0 } },
      ],
    };
    const result = solveConflictRouting(input);
    expectValid(input, result);
    if (result.kind === 'found') expect(result.diagnostics.expandedNodes).toBe(0);
    input.routes[1].start = { x: 0, y: 0 };
    expect(solveConflictRouting(input)).toMatchObject({ kind: 'no-solution' });
  });

  it('takes a longer route to avoid costly cells while keeping the global layout valid', () => {
    const input: RoutingInput = {
      width: 5,
      height: 3,
      blocked: new Uint8Array(15),
      penalties: new Float64Array(15),
      routes: [
        { id: 'a', start: { x: 0, y: 1 }, goal: { x: 4, y: 1 } },
        { id: 'b', start: { x: 0, y: 2 }, goal: { x: 4, y: 2 } },
      ],
    };
    input.penalties![7] = 20;
    const result = solveConflictRouting(input);
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.cost).toBe(10);
      expect(result.routes[0].cells).not.toContainEqual({ x: 2, y: 1 });
    }
  });

  it('rejects a total cost that overflows even when individual routes have finite costs', () => {
    expect(
      solveConflictRouting({
        width: 4,
        height: 1,
        blocked: new Uint8Array(4),
        penalties: new Float64Array(4).fill(Number.MAX_VALUE),
        routes: [
          { id: 'a', start: { x: 0, y: 0 }, goal: { x: 1, y: 0 } },
          { id: 'b', start: { x: 2, y: 0 }, goal: { x: 3, y: 0 } },
        ],
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('reports either budget limit honestly and never returns provisional overlapping paths', () => {
    const result = solveConflictRouting(crossing(), { maxNodes: 0 });
    expect(result).toMatchObject({ kind: 'budget-exhausted', diagnostics: { expandedNodes: 0 } });
    expect(result).not.toHaveProperty('routes');
    if (result.kind === 'budget-exhausted') {
      expect(result.diagnostics.remainingConflicts).toBeGreaterThan(0);
      expect(result.diagnostics.conflict).toMatchObject({ first: 'a', second: 'b' });
    }
    expect(solveConflictRouting(crossing(), { maxPathStates: 1 })).toMatchObject({
      kind: 'budget-exhausted',
      diagnostics: { pathStates: 1 },
    });
    expect(solveConflictRouting(crossing(), { maxPathStates: 0 })).toMatchObject({
      kind: 'budget-exhausted',
      diagnostics: { pathStates: 0 },
    });
  });

  it('is independent of request ordering and does not mutate input or previous results', () => {
    const input = crossing();
    const original = structuredClone(input);
    const first = solveConflictRouting(input);
    const saved = structuredClone(first);
    const reordered = { ...input, routes: [...input.routes].reverse() };
    expect(solveConflictRouting(reordered)).toEqual(first);
    expect(solveConflictRouting(input)).toEqual(first);
    expect(input).toEqual(original);
    expect(first).toEqual(saved);
    expect(solveConflictRouting(reordered, { maxNodes: 1 })).toEqual(
      solveConflictRouting(input, { maxNodes: 1 }),
    );
  });

  it('routes tens of noncompeting pairs without a global branching search', () => {
    const input: RoutingInput = {
      width: 96,
      height: 64,
      blocked: new Uint8Array(96 * 64),
      routes: Array.from({ length: 30 }, (_, index) => ({
        id: `route-${index}`,
        start: { x: 1, y: index * 2 },
        goal: { x: 94, y: index * 2 },
      })),
    };
    const result = solveConflictRouting(input);
    expectValid(input, result);
    if (result.kind === 'found') {
      expect(result.diagnostics.expandedNodes).toBe(0);
      expect(result.diagnostics.pathSearches).toBe(30);
      expect(result.diagnostics.pathStates).toBeLessThan(3_000);
    }
  });

  it('handles empty requests and rejects malformed requests, geometry, costs, and budgets', () => {
    expectValid({ ...crossing(), routes: [] }, solveConflictRouting({ ...crossing(), routes: [] }));
    const input = crossing();
    for (const patch of [
      { width: 0 },
      { blocked: new Uint8Array(1) },
      { routes: [input.routes[0], input.routes[0]] },
      { routes: [{ ...input.routes[0], start: { x: 0.5, y: 0 } }] },
      { penalties: new Float64Array(49).fill(-1) },
      { penalties: new Float64Array(49).fill(NaN) },
    ])
      expect(solveConflictRouting({ ...input, ...patch })).toMatchObject({ kind: 'invalid' });
    for (const options of [
      { maxNodes: -1 },
      { maxPathStates: 1.5 },
      { maxReservationStates: -1 },
      { maxReservationStates: 1.5 },
      { costSlack: Infinity },
      { costSlack: -1 },
    ])
      expect(solveConflictRouting(input, options)).toMatchObject({ kind: 'invalid' });
  });
});
