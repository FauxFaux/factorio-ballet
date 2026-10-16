import { describe, expect, it } from 'vitest';
import { CpSat, setCloudNoticeEnabled } from 'or-tools-wasm/cp-sat';
import {
  buildBobPairings,
  buildBobPairedPlacement,
  solveBobPairedLayout,
} from '../../src/compute/bobs/paired-solver.ts';
import { annealBobBases } from '../../src/compute/bobs/base-annealing.ts';
import { defaultBobPairOptions } from '../../src/compute/bobs/paired-options.ts';
import { defaultBobOptions, type BobProblem } from '../../src/compute/bobs/types.ts';
import { bobTransportData } from '../../src/compute/bobs/problem-data.ts';
import { validateBobLayout } from '../../src/compute/bobs/validate.ts';

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
  ...defaultBobOptions(simple),
  ...defaultBobPairOptions,
  maxWidth: 10,
  maxHeight: 6,
  maxTimeInSeconds: 2,
};
setCloudNoticeEnabled(false);

describe('Bob fixed pairings', () => {
  it('balances gross fan-in and fan-out before considering geometry', async () => {
    const problem: BobProblem = {
      machines: [
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `cable:${i}`,
          label: 'Cable',
          size: { width: 3, height: 3 },
          inputs: { 'item:copper': 1.5 },
          outputs: { 'item:cable': 3 },
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `circuit:${i}`,
          label: 'Circuit',
          size: { width: 3, height: 3 },
          inputs: { 'item:cable': 4.5, 'item:iron': 1.5 },
          outputs: { 'item:circuit': 1.5 },
        })),
      ],
      inputs: ['item:copper', 'item:iron'],
      outputs: ['item:circuit'],
    };
    const built = buildBobPairings(problem, { ...options, maxInserters: 11 });
    const solved = await CpSat.solve(built.model, { maxTimeInSeconds: 2, numWorkers: 1 });
    expect(solved.hasSolution).toBe(true);
    const pairs = built.read(solved);
    expect(pairs).toHaveLength(11);
    const data = bobTransportData(problem);
    for (const port of data.ports) {
      const rate = pairs
        .filter((p) => (port.side === 'input' ? p.to : p.from) === port.node)
        .reduce((n, p) => n + (p.rates[port.resource] ?? 0), 0);
      expect(rate).toBeCloseTo(port.rate, 6);
    }
    for (const id of ['circuit:0', 'circuit:1'])
      expect(
        pairs.filter((p) => p.to === id && p.rates['item:cable']).length,
      ).toBeGreaterThanOrEqual(2);
  });

  it('puts inputs left and outputs right by default while retaining the any-edge option', async () => {
    const pairs = [
      { from: 'source:item:iron', to: 'a', rates: { 'item:iron': 1 } },
      { from: 'a', to: 'sink:item:gear', rates: { 'item:gear': 1 } },
    ];
    const built = buildBobPairedPlacement(simple, pairs, options);
    const solved = await CpSat.solve(built.model, { maxTimeInSeconds: 2, numWorkers: 1 });
    expect(solved.hasSolution).toBe(true);
    const layout = built.read(solved);
    expect(layout.nodes.find((n) => n.kind === 'source')!.position.x).toBe(0);
    const sink = layout.nodes.find((n) => n.kind === 'sink')!;
    expect(sink.position.x + sink.size.width).toBe(layout.width);
    // Four source chests cannot share a left edge only three tiles tall.
    const crowded: BobProblem = {
      machines: [
        {
          id: 'a',
          label: 'A',
          size: { width: 3, height: 3 },
          inputs: { 'item:a': 1, 'item:b': 1, 'item:c': 1, 'item:d': 1 },
          outputs: {},
        },
      ],
      inputs: ['item:a', 'item:b', 'item:c', 'item:d'],
      outputs: [],
    };
    const deliveries = crowded.inputs.map((resource) => ({
      from: `source:${resource}`,
      to: 'a',
      rates: { [resource]: 1 },
    }));
    for (const boundaryEdges of ['any', 'left-right'] as const) {
      const narrow = buildBobPairedPlacement(crowded, deliveries, {
        ...options,
        maxWidth: 7,
        maxHeight: 3,
        boundaryEdges,
      });
      const answer = await CpSat.solve(narrow.model, { maxTimeInSeconds: 2, numWorkers: 1 });
      expect(answer.hasSolution).toBe(boundaryEdges === 'any');
    }
  });

  it('prefers equal reaches on a fixed connection without lengthening their sum', async () => {
    const problem: BobProblem = {
      machines: [
        {
          id: 'a',
          label: 'A',
          size: { width: 5, height: 1 },
          inputs: {},
          outputs: { 'item:x': 1 },
        },
        {
          id: 'b',
          label: 'B',
          size: { width: 5, height: 1 },
          inputs: { 'item:x': 1 },
          outputs: {},
        },
      ],
      inputs: [],
      outputs: [],
    };
    const pair = { from: 'a', to: 'b', rates: { 'item:x': 1 } };
    const solve = async (balanceWeight: number, baseX?: number) => {
      const built = buildBobPairedPlacement(problem, [pair], {
        ...options,
        maxWidth: 15,
        maxHeight: 1,
        breakSymmetry: false,
        balanceWeight,
      });
      built.nodes.forEach((node, i) => {
        built.model.add(node.x.eq(i * 10));
        built.model.add(node.y.eq(0));
      });
      if (baseX !== undefined) built.model.add(built.arms[0].base.x.eq(baseX));
      const result = await CpSat.solve(built.model, { maxTimeInSeconds: 2, numWorkers: 1 });
      expect(result.hasSolution).toBe(true);
      return { layout: built.read(result), score: result.objectiveValue! };
    };
    const balanced = await solve(1);
    expect(balanced.layout.inserters[0].position).toEqual({ x: 7, y: 0 });
    const unbalanced = await solve(1, 5);
    expect(balanced.score).toBeLessThan(unbalanced.score);
    const disabledBalanced = await solve(0, 7);
    const disabledUnbalanced = await solve(0, 5);
    expect(disabledBalanced.score).toBe(disabledUnbalanced.score);
    // Even a strong balance reward must not fake equal reaches by selecting
    // a deeper endpoint inside a machine instead of its nearest footprint tile.
    const strong = await solve(10, 5);
    expect(strong.layout.inserters[0].pickup).toEqual({ x: 4, y: 0 });
    expect(strong.layout.inserters[0].dropoff).toEqual({ x: 10, y: 0 });
    expect(strong.score).toBeGreaterThan(unbalanced.score);
  });

  it('rejects invalid balance weights', () => {
    for (const balanceWeight of [-1, 0.5, NaN, Infinity]) {
      expect(() => buildBobPairedPlacement(simple, [], { ...options, balanceWeight })).toThrow(
        'Balance weight',
      );
    }
  });

  it('allocates parallel bases using the exposed pairing capacity', async () => {
    const built = buildBobPairings(simple, { ...options, pairingCapacity: 0.5, maxInserters: 4 });
    const solved = await CpSat.solve(built.model, { maxTimeInSeconds: 2, numWorkers: 1 });
    expect(solved.hasSolution).toBe(true);
    expect(built.read(solved)).toHaveLength(4);
    expect(
      built
        .read(solved)
        .every((p) => Object.values(p.rates).reduce<number>((n, r) => n + r!, 0) <= 0.5),
    ).toBe(true);
  });

  it('keeps the relaxed snapshot and validates the legalized result', async () => {
    const result = await solveBobPairedLayout(simple, options);
    expect(result.status).toBe('feasible');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts![0].layout.transport).toBe('relaxed');
    expect(result.attempts![0].layout.inserters.map((a) => [a.from, a.to, a.rates])).toEqual(
      result.layout!.inserters.map((a) => [a.from, a.to, a.rates]),
    );
    expect(validateBobLayout(simple, result.layout!)).toEqual([]);
  }, 10_000);

  it('retains unknown feasibility when a fixed topology exceeds the inserter budget', async () => {
    const result = await solveBobPairedLayout(simple, { ...options, maxInserters: 1 });
    expect(result.status).toBe('unknown');
    expect(result.layout).toBeUndefined();
  });

  it('does not constrain relaxed placement to legal reach and refuses to legalize impossible endpoints', async () => {
    const pairs = [{ from: 'source:item:iron', to: 'a', rates: { 'item:iron': 1 } }];
    const built = buildBobPairedPlacement(simple, pairs, options);
    const solved = await CpSat.solve(built.model, { maxTimeInSeconds: 2, numWorkers: 1 });
    expect(solved.hasSolution).toBe(true);
    const layout = built.read(solved);
    const source = layout.nodes.find((n) => n.kind === 'source')!;
    source.position = { x: 0, y: 0 };
    layout.nodes.find((n) => n.id === 'a')!.position = { x: 20, y: 0 };
    layout.width = 24;
    expect(await annealBobBases(layout, 1)).toBeUndefined();
  });

  it('anneals colliding bases while preserving fixed pair flows', async () => {
    const problem: BobProblem = {
      machines: ['a', 'b'].map((id) => ({
        id,
        label: id,
        size: { width: 1, height: 1 },
        inputs: { 'item:iron': 1 },
        outputs: {},
      })),
      inputs: ['item:iron'],
      outputs: [],
    };
    const nodes = bobTransportData(problem).nodes.map((n) => ({
      ...n,
      position: n.id === 'a' ? { x: 2, y: 0 } : n.id === 'b' ? { x: 2, y: 2 } : { x: 0, y: 0 },
    }));
    const arms = ['a', 'b'].map((to) => ({
      from: 'source:item:iron',
      to,
      rates: { 'item:iron': 1 },
      position: { x: 1, y: 1 },
      pickup: { x: 0, y: 0 },
      dropoff: { x: 2, y: 0 },
      capacity: 0,
    }));
    const result = await annealBobBases(
      { width: 4, height: 4, nodes, inserters: arms, transport: 'relaxed' },
      1,
    );
    expect(result).toBeDefined();
    expect(new Set(result!.inserters.map((a) => `${a.position.x},${a.position.y}`)).size).toBe(2);
    expect(result!.nodes).toEqual(nodes);
    expect(validateBobLayout(problem, result!)).toEqual([]);
  });

  it('honors cancellation before pairing and during base refinement', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(solveBobPairedLayout(simple, options, abort.signal)).rejects.toThrow();
    await expect(
      annealBobBases({ width: 1, height: 1, nodes: [], inserters: [] }, 1, abort.signal),
    ).rejects.toThrow();
  });
});
