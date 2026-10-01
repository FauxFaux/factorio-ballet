import { describe, expect, it } from 'vitest';
import { computeRoutingContention } from '../../../src/compute/routing/contention.ts';
import type { RoutingInput } from '../../../src/compute/routing/types.ts';

function crossing(): RoutingInput {
  return {
    width: 7,
    height: 7,
    blocked: new Uint8Array(49),
    routes: [
      { id: 'horizontal', start: { x: 0, y: 3 }, goal: { x: 6, y: 3 } },
      { id: 'vertical', start: { x: 3, y: 0 }, goal: { x: 3, y: 6 } },
    ],
  };
}

describe('computeRoutingContention', () => {
  it('reroutes around all earlier contested cells and retains their maximum counts', () => {
    const input = crossing();
    const result = computeRoutingContention(input);
    expect(result.kind).toBe('contention');
    if (result.kind !== 'contention') return;
    expect(result.status).toBe('complete');
    expect(result.generations).toHaveLength(3);
    expect(result.generations[0][24]).toBe(2);
    expect(result.generations[1][24]).toBe(0);
    expect(result.generations[1].some((count) => count === 2)).toBe(true);
    for (let index = 0; index < 49; index++) {
      expect(result.maximum[index]).toBe(Math.max(...result.generations.map((map) => map[index])));
      if (result.generations[0][index] || result.generations[1][index])
        expect(result.generations[2][index]).toBe(0);
    }
    expect(input.blocked.every((cell) => cell === 0)).toBe(true);
    expect(computeRoutingContention({ ...input, routes: [...input.routes].reverse() })).toEqual(
      result,
    );
  });

  it('counts paths rather than pairs of conflicts and blocks contested endpoints too', () => {
    const result = computeRoutingContention({
      width: 3,
      height: 1,
      blocked: new Uint8Array(3),
      routes: ['a', 'b', 'c'].map((id) => ({ id, start: { x: 0, y: 0 }, goal: { x: 2, y: 0 } })),
    });
    expect(result.kind).toBe('contention');
    if (result.kind !== 'contention') return;
    expect(Array.from(result.maximum)).toEqual([3, 3, 3]);
    expect(result.generations.map((map) => Array.from(map))).toEqual([
      [3, 3, 3],
      [0, 0, 0],
    ]);
  });

  it('keeps completed generations when the shared budget runs out', () => {
    const first = computeRoutingContention(crossing(), {}, 1);
    if (first.kind !== 'contention') throw new Error('Expected contention');
    const result = computeRoutingContention(crossing(), {
      maxPathStates: first.diagnostics.pathStates,
    });
    expect(result).toMatchObject({
      kind: 'contention',
      status: 'budget-exhausted',
      generations: first.generations,
      maximum: first.maximum,
    });
  });

  it('ignores unreachable pairs and singly occupied cells', () => {
    const input = crossing();
    input.blocked.fill(1, 7, 14);
    const result = computeRoutingContention(input);
    expect(result.kind).toBe('contention');
    if (result.kind !== 'contention') return;
    expect(result.generations).toHaveLength(1);
    expect(result.maximum.every((count) => count === 0)).toBe(true);
  });

  it('rejects invalid requests and work limits', () => {
    expect(computeRoutingContention(crossing(), {}, 0).kind).toBe('invalid');
    expect(computeRoutingContention(crossing(), { maxPathStates: -1 }).kind).toBe('invalid');
    const input = crossing();
    input.routes[0].start.x = -1;
    expect(computeRoutingContention(input).kind).toBe('invalid');
  });
});
