import { describe, expect, it } from 'vitest';
import { CpSat, setCloudNoticeEnabled } from 'or-tools-wasm/cp-sat';
import { buildClassicModel, solveClassicLayout } from '../../src/compute/bobs/bobs-solver.ts';
import { classicSwings } from '../../src/compute/bobs/geometry.ts';
import { validateBobLayout } from '../../src/compute/bobs/validate.ts';
import type { BobProblem } from '../../src/compute/bobs/types.ts';

setCloudNoticeEnabled(false);
const simple: BobProblem = {
  machines: [
    {
      id: 'a',
      label: 'A',
      size: { width: 3, height: 3 },
      inputs: { 'item:iron': 1 },
      outputs: { 'item:gear': 1 },
    },
  ],
  inputs: ['item:iron'],
  outputs: ['item:gear'],
};
const options = {
  maxWidth: 8,
  maxHeight: 8,
  maxChests: 0,
  maxInserters: 2,
  maxTimeInSeconds: 3,
  numWorkers: 1,
};

describe('classic joint CP-SAT layout', () => {
  it('enumerates exactly the two lengths and four directed rotations', () => {
    const tuples = classicSwings().map((s) => [s.pickup.x, s.pickup.y, s.dropoff.x, s.dropoff.y]);
    expect(tuples).toEqual([
      [1, 0, -1, 0],
      [-1, 0, 1, 0],
      [0, 1, 0, -1],
      [0, -1, 0, 1],
      [2, 0, -2, 0],
      [-2, 0, 2, 0],
      [0, 2, 0, -2],
      [0, -2, 0, 2],
    ]);
    expect(classicSwings().every((s) => s.capacity === 144)).toBe(true);
  });

  it.each(classicSwings())('allows directed pickup $pickup and dropoff $dropoff', async (swing) => {
    const problem: BobProblem = {
      machines: [{ ...simple.machines[0], size: { width: 1, height: 1 }, outputs: {} }],
      inputs: simple.inputs,
      outputs: [],
    };
    const base = { x: Math.abs(swing.pickup.x), y: Math.abs(swing.pickup.y) };
    const built = buildClassicModel(problem, {
      ...options,
      maxWidth: base.x * 2 + 1,
      maxHeight: base.y * 2 + 1,
      maxInserters: 1,
    });
    built.nodes.forEach((node, i) => {
      const offset = i === 0 ? swing.dropoff : swing.pickup;
      built.model.add(node.x.eq(base.x + offset.x));
      built.model.add(node.y.eq(base.y + offset.y));
    });
    built.model.add(built.slots[0].base.x.eq(base.x));
    built.model.add(built.slots[0].base.y.eq(base.y));
    const solved = await CpSat.solve(built.model, { numWorkers: 1, maxTimeInSeconds: 2 });
    expect(solved.hasSolution).toBe(true);
    const layout = built.read(solved);
    expect(layout.inserters).toHaveLength(1);
    expect(validateBobLayout(problem, layout, { classic: true })).toEqual([]);
  });

  it('finds and independently validates an optimal complete layout in one solve', async () => {
    const published: unknown[] = [];
    const result = await solveClassicLayout(simple, options, undefined, (a) => published.push(a));
    expect(result.status).toBe('optimal');
    expect(result.layout!.width + result.layout!.height).toBe(8);
    expect(result.layout!.inserters).toHaveLength(2);
    expect(validateBobLayout(simple, result.layout!, { classic: true })).toEqual([]);
    expect(published).toEqual(result.attempts);
  });

  it('lets a long arm cross an occupied intermediate tile', async () => {
    const problem: BobProblem = {
      machines: [
        { ...simple.machines[0], size: { width: 1, height: 1 }, outputs: {} },
        {
          id: 'obstacle',
          label: 'Obstacle',
          size: { width: 1, height: 1 },
          inputs: {},
          outputs: {},
        },
      ],
      inputs: simple.inputs,
      outputs: [],
    };
    const built = buildClassicModel(problem, {
      ...options,
      maxWidth: 5,
      maxHeight: 1,
      maxInserters: 1,
    });
    // source, skipped occupied tile, long base, skipped free tile, consumer
    const xs = [4, 1, 0];
    built.nodes.forEach((n, i) => {
      built.model.add(n.x.eq(xs[i]));
      built.model.add(n.y.eq(0));
    });
    built.model.add(built.slots[0].base.x.eq(2));
    const solved = await CpSat.solve(built.model, { numWorkers: 1, maxTimeInSeconds: 2 });
    expect(solved.hasSolution).toBe(true);
    const layout = built.read(solved);
    expect(layout.inserters[0].pickup).toEqual({ x: 0, y: 0 });
    expect(layout.inserters[0].dropoff).toEqual({ x: 4, y: 0 });
    expect(validateBobLayout(problem, layout, { classic: true })).toEqual([]);
  });

  it('supports relay chains in the same joint model', async () => {
    const problem: BobProblem = {
      machines: [{ ...simple.machines[0], size: { width: 1, height: 1 }, outputs: {} }],
      inputs: simple.inputs,
      outputs: [],
    };
    const built = buildClassicModel(problem, {
      ...options,
      maxWidth: 7,
      maxHeight: 1,
      maxChests: 2,
      maxInserters: 3,
    });
    // All three bases and both relays must participate to traverse this row.
    const xs = [6, 0, 2, 4];
    built.nodes.forEach((n, i) => {
      built.model.add(n.x.eq(xs[i]));
      built.model.add(n.y.eq(0));
      built.model.add(n.present.eq(1));
    });
    const solved = await CpSat.solve(built.model, { numWorkers: 1, maxTimeInSeconds: 2 });
    expect(solved.hasSolution).toBe(true);
    const layout = built.read(solved);
    expect(layout.inserters.some((i) => i.from === 'chest:0' && i.to === 'chest:1')).toBe(true);
    expect(validateBobLayout(problem, layout, { classic: true })).toEqual([]);
  });

  it('proves infeasibility when only a bent inserter could fit', async () => {
    const problem: BobProblem = {
      machines: [{ ...simple.machines[0], size: { width: 1, height: 1 }, outputs: {} }],
      inputs: simple.inputs,
      outputs: [],
    };
    const result = await solveClassicLayout(problem, { ...options, maxWidth: 2, maxHeight: 2 });
    expect(result.status).toBe('infeasible');
    expect(result.layout).toBeUndefined();
  });

  it('keeps timeouts distinct from proven impossibility', async () => {
    const result = await solveClassicLayout(simple, { ...options, maxTimeInSeconds: 0 });
    expect(result.status).toBe('unknown');
    expect(result.layout).toBeUndefined();
  });

  it('enforces shared classic capacity while allowing parallel arms', async () => {
    const rates = { 'item:iron': 80, 'item:copper': 80 };
    const problem: BobProblem = {
      machines: [
        { ...simple.machines[0], id: 'producer', inputs: {}, outputs: rates },
        { ...simple.machines[0], id: 'consumer', inputs: rates, outputs: {} },
      ],
      inputs: [],
      outputs: [],
    };
    expect((await solveClassicLayout(problem, { ...options, maxInserters: 1 })).status).toBe(
      'infeasible',
    );
    const result = await solveClassicLayout(problem, options);
    expect(result.layout).toBeDefined();
    const feeders = result.layout!.inserters.filter((i) => i.to === 'consumer');
    expect(feeders).toHaveLength(2);
    for (const resource of ['item:iron', 'item:copper'] as const)
      expect(feeders.reduce((n, i) => n + (i.rates[resource] ?? 0), 0)).toBe(80);
    expect(validateBobLayout(problem, result.layout!, { classic: true })).toEqual([]);
  });

  it('rejects bent, diagonal, mixed-length and reach-three arms in independent validation', async () => {
    const result = await solveClassicLayout(simple, options);
    for (const offset of [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]) {
      const broken = structuredClone(result.layout!);
      broken.inserters[0].pickup = {
        x: broken.inserters[0].position.x + offset.x,
        y: broken.inserters[0].position.y + offset.y,
      };
      broken.inserters[0].dropoff = {
        x: broken.inserters[0].position.x - 1,
        y: broken.inserters[0].position.y,
      };
      expect(validateBobLayout(simple, broken, { classic: true })).toContain(
        'Classic inserters must be straight, with equal reach of one or two tiles',
      );
    }
  });

  it('does not inherit assembler or rate safety caps', () => {
    const problem: BobProblem = {
      machines: Array.from({ length: 25 }, (_, i) => ({
        ...simple.machines[0],
        id: `a${i}`,
        inputs: { 'item:iron': 2_000_000 },
        outputs: {},
      })),
      inputs: simple.inputs,
      outputs: [],
    };
    expect(() => buildClassicModel(problem, { ...options, maxInserters: 0 })).not.toThrow();
  });

  it('honors cancellation before model construction', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(solveClassicLayout(simple, options, abort.signal)).rejects.toThrow();
  });
});
