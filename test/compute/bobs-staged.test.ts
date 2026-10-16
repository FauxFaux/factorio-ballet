import { describe, expect, it, vi } from 'vitest';
import { CpModel, CpResult, CpSat, setCloudNoticeEnabled } from 'or-tools-wasm/cp-sat';
import { solveBobLayout } from '../../src/compute/bobs/staged-solver.ts';
import { buildBobPlacement } from '../../src/compute/bobs/placement.ts';
import { buildBobTransport, BobTransportTimeout } from '../../src/compute/bobs/transport.ts';
import { bobTransportData } from '../../src/compute/bobs/problem-data.ts';
import { validateBobLayout } from '../../src/compute/bobs/validate.ts';
import { bobCapacity } from '../../src/compute/bobs/geometry.ts';
import {
  defaultBobOptions,
  type BobAttempt,
  type BobLayout,
  type BobProblem,
} from '../../src/compute/bobs/types.ts';

const problem: BobProblem = {
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

describe('Bob placement refinement', () => {
  it('connects a narrow row of machines through relay chests during the full refinement search', async () => {
    const long: BobProblem = {
      machines: Array.from({ length: 8 }, (_, i) => ({
        id: `machine:${i}`,
        label: `Machine ${i + 1}`,
        size: { width: 3, height: 3 },
        inputs: { 'item:iron': 1 },
        outputs: {},
      })),
      inputs: ['item:iron'],
      outputs: [],
    };
    // In a 4×24 rectangle these eight machines must form a vertical row.
    // One source cannot directly reach both ends, even at maximum arm reach.
    const result = await solveBobLayout(long, {
      maxWidth: 4,
      maxHeight: 24,
      maxChests: 4,
      maxInserters: 16,
      maxTimeInSeconds: 12,
    });
    expect(result.status).toBe('feasible');
    expect(result.layout!.nodes.filter((n) => n.kind === 'chest').length).toBeGreaterThan(0);
    expect(validateBobLayout(long, result.layout!)).toEqual([]);
  }, 20_000);

  it('continues beyond twelve inconclusive rounds until the time budget expires', async () => {
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const solve = vi.spyOn(CpSat, 'solve').mockImplementation(async () => {
      elapsed += 50;
      return new CpResult(new CpModel(), null, 0);
    });
    try {
      const result = await solveBobLayout(problem, { maxTimeInSeconds: 1 });
      expect(solve).toHaveBeenCalledTimes(20);
      expect(result.status).toBe('unknown');
      expect(result.message).toContain('within the time budget');
    } finally {
      solve.mockRestore();
      clock.mockRestore();
    }
  });

  it('rearranges a failed placement without exceeding fixed rectangle bounds', async () => {
    const two = {
      ...problem,
      machines: [problem.machines[0], { ...problem.machines[0], id: 'b', label: 'B' }],
    };
    const result = await solveBobLayout(two, {
      maxWidth: 6,
      maxHeight: 4,
      maxChests: 0,
      maxInserters: 4,
      maxTimeInSeconds: 5,
    });
    expect(result.status).toBe('feasible');
    expect(result.attempts!.length).toBeGreaterThan(1);
    expect(result.attempts![0].stage).toBe('conflict');
    expect(result.attempts!.every((a) => a.layout.width <= 6 && a.layout.height <= 4)).toBe(true);
    expect(validateBobLayout(two, result.layout!)).toEqual([]);
  }, 10_000);

  it('retains failed placements, promotes difficult inserters, and publishes snapshots before transport', async () => {
    const two = {
      ...problem,
      machines: [problem.machines[0], { ...problem.machines[0], id: 'b', label: 'B' }],
    };
    const snapshots: BobAttempt[] = [];
    const result = await solveBobLayout(
      two,
      { maxWidth: 12, maxHeight: 12, maxChests: 2, maxInserters: 12, maxTimeInSeconds: 8 },
      undefined,
      (a) => snapshots.push(a),
    );
    expect(result.status).toBe('feasible');
    expect(result.attempts!.length).toBeGreaterThan(1);
    expect(result.attempts![0].stage).toBe('conflict');
    expect(result.attempts![0].conflicts.some((c) => c.tiles.length > 0)).toBe(true);
    expect(
      result.attempts!.some((a) => a.promoted.length > 0 && a.layout.inserters.length > 0),
    ).toBe(true);
    expect(result.attempts!.at(-1)!.stage).toBe('solved');
    expect(snapshots[0].stage).toBe('placement');
    expect(snapshots[0].layout.inserters).toEqual([]);
    expect(result.attempts!.map((a) => a.id)).toEqual(result.attempts!.map((_, i) => i + 1));
    expect(validateBobLayout(two, result.layout!)).toEqual([]);
  }, 15_000);

  it('cancels between placement and transport while preserving the published placement', async () => {
    const controller = new AbortController();
    const snapshots: BobAttempt[] = [];
    await expect(
      solveBobLayout(problem, { maxTimeInSeconds: 3 }, controller.signal, (a) => {
        snapshots.push(a);
        controller.abort();
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].stage).toBe('placement');
  }, 10_000);
});

describe('Bob promoted inserter sharing', () => {
  it.each([false, true])(
    'shares an inserter across both promoted ends, with multiple resources: %s',
    async (multiple) => {
      const rates = { 'item:iron': 1, ...(multiple ? { 'item:copper': 2 } : {}) };
      const paired: BobProblem = {
        machines: [
          {
            id: 'producer',
            label: 'Producer',
            size: { width: 1, height: 1 },
            inputs: {},
            outputs: rates,
          },
          {
            id: 'consumer',
            label: 'Consumer',
            size: { width: 1, height: 1 },
            inputs: rates,
            outputs: {},
          },
        ],
        inputs: [],
        outputs: [],
      };
      const data = bobTransportData(paired);
      const options = {
        ...defaultBobOptions(paired),
        maxWidth: 3,
        maxHeight: 1,
        maxChests: 0,
        maxInserters: 1,
      };
      const placement = buildBobPlacement(data, options, data.ports, []);
      const result = await CpSat.solve(placement.model, { numWorkers: 1, maxTimeInSeconds: 2 });
      expect(result.hasSolution).toBe(true);
      const layout = placement.read(result);
      expect(layout.inserters).toHaveLength(1);
      expect(layout.inserters[0].rates).toEqual(rates);
      expect(validateBobLayout(paired, layout)).toEqual([]);
    },
  );
});

describe('Bob fixed placement transport', () => {
  it('drops redundant reservation hints instead of forcing two inserters to share one small flow', async () => {
    const paired: BobProblem = {
      machines: [
        {
          id: 'producer',
          label: 'Producer',
          size: { width: 1, height: 1 },
          inputs: {},
          outputs: { 'item:iron': 1 },
        },
        {
          id: 'consumer',
          label: 'Consumer',
          size: { width: 1, height: 1 },
          inputs: { 'item:iron': 1 },
          outputs: {},
        },
      ],
      inputs: [],
      outputs: [],
    };
    const data = bobTransportData(paired);
    const layout: BobLayout = {
      width: 3,
      height: 2,
      nodes: data.nodes.map((n, i) => ({ ...n, position: { x: i * 2, y: 0 } })),
      inserters: [0, 1].map((y) => ({
        position: { x: 1, y },
        pickup: { x: 0, y: 0 },
        dropoff: { x: 2, y: 0 },
        from: 'producer',
        to: 'consumer',
        rates: { 'item:iron': 0.5 },
        capacity: bobCapacity({ x: -1, y: -y }, { x: 1, y: -y }),
      })),
    };
    const transport = await buildBobTransport(
      data,
      layout,
      { ...defaultBobOptions(paired), maxChests: 0, maxInserters: 2 },
      false,
      undefined,
      Infinity,
      'hints',
    );
    const result = await CpSat.solve(transport.model, { numWorkers: 1, maxTimeInSeconds: 1 });
    expect(result.hasSolution).toBe(true);
    const connected = transport.read(result);
    expect(connected.inserters).toHaveLength(1);
    expect(connected.inserters[0].rates).toEqual({ 'item:iron': 1 });
    expect(validateBobLayout(paired, connected)).toEqual([]);
    expect(layout.inserters).toHaveLength(2);
  });

  it('supports three inserters sharing a relay while preserving promoted arm positions', async () => {
    const branching: BobProblem = {
      ...problem,
      machines: ['a', 'b'].map((id) => ({
        ...problem.machines[0],
        id,
        size: { width: 1, height: 1 },
      })),
    };
    const data = bobTransportData(branching);
    const positions = [
      { x: 3, y: 1 },
      { x: 4, y: 2 },
      { x: 0, y: 1 },
      { x: 5, y: 1 },
      { x: 2, y: 0 },
    ];
    const nodes = [
      ...data.nodes,
      {
        id: 'relay',
        label: 'Relay',
        kind: 'chest' as const,
        position: positions[4],
        size: { width: 1, height: 1 },
      },
    ].map((n, i) => ({ ...n, position: positions[i] }));
    const transfers = [
      { from: 2, to: 4, position: { x: 1, y: 0 }, rates: { 'item:iron': 2 } },
      { from: 4, to: 0, position: { x: 2, y: 1 }, rates: { 'item:iron': 1 } },
      { from: 4, to: 1, position: { x: 2, y: 2 }, rates: { 'item:iron': 1 } },
      { from: 0, to: 3, position: { x: 4, y: 1 }, rates: { 'item:gear': 1 } },
      { from: 1, to: 3, position: { x: 5, y: 2 }, rates: { 'item:gear': 1 } },
    ];
    const layout: BobLayout = {
      width: 6,
      height: 3,
      nodes,
      inserters: transfers.map((t) => ({
        ...t,
        from: nodes[t.from].id,
        to: nodes[t.to].id,
        pickup: positions[t.from],
        dropoff: positions[t.to],
        capacity: bobCapacity(
          { x: positions[t.from].x - t.position.x, y: positions[t.from].y - t.position.y },
          { x: positions[t.to].x - t.position.x, y: positions[t.to].y - t.position.y },
        ),
      })),
    };
    const transport = await buildBobTransport(
      data,
      layout,
      { ...defaultBobOptions(branching), maxChests: 1, maxInserters: 5 },
      false,
    );
    const selected = await CpSat.solve(transport.model, { numWorkers: 1, maxTimeInSeconds: 1 });
    expect(selected.hasSolution).toBe(true);
    const result = transport.read(selected);
    expect(validateBobLayout(branching, result)).toEqual([]);
    expect(result.inserters.filter((a) => a.from === 'relay' || a.to === 'relay')).toHaveLength(3);
    expect(result.inserters).toEqual(
      expect.arrayContaining(
        layout.inserters.map((a) =>
          expect.objectContaining({
            position: a.position,
            from: a.from,
            to: a.to,
            pickup: a.pickup,
            dropoff: a.dropoff,
          }),
        ),
      ),
    );
  });

  const data = bobTransportData(problem);
  const layout: BobLayout = {
    width: 12,
    height: 3,
    inserters: [],
    nodes: data.nodes.map((n) => ({
      ...n,
      position:
        n.id === 'a' ? { x: 8, y: 0 } : n.kind === 'source' ? { x: 0, y: 1 } : { x: 11, y: 1 },
    })),
  };
  const options = {
    ...defaultBobOptions(problem),
    maxWidth: 12,
    maxHeight: 3,
    maxChests: 1,
    maxInserters: 3,
  };

  it('replaces an unhelpful reserved relay instead of consuming the whole chest budget with it', async () => {
    const reserved: BobLayout = {
      ...layout,
      nodes: [
        ...layout.nodes,
        {
          id: 'chest:reserved:0',
          label: 'Reserved relay',
          kind: 'chest',
          position: { x: 1, y: 0 },
          size: { width: 1, height: 1 },
        },
      ],
      inserters: [
        {
          position: { x: 0, y: 0 },
          pickup: { x: 0, y: 1 },
          dropoff: { x: 1, y: 0 },
          from: 'source:item:iron',
          to: 'chest:reserved:0',
          capacity: 288,
          rates: { 'item:iron': 1 },
        },
      ],
    };
    const fixed = await buildBobTransport(data, reserved, options, true);
    expect(
      (await CpSat.solve(fixed.model, { numWorkers: 1, maxTimeInSeconds: 1 })).hasSolution,
    ).toBe(false);
    const flexible = await buildBobTransport(
      data,
      reserved,
      options,
      true,
      undefined,
      Infinity,
      'hints',
    );
    const selected = await CpSat.solve(flexible.model, { numWorkers: 1, maxTimeInSeconds: 2 });
    expect(selected.hasSolution).toBe(true);
    const result = flexible.read(selected);
    expect(result.nodes.filter((n) => n.kind === 'chest')).toHaveLength(1);
    expect(result.nodes.some((n) => n.id === 'chest:reserved:0')).toBe(false);
    expect(validateBobLayout(problem, result)).toEqual([]);
  });

  it('finds a relay route that cannot connect directly, with no endpoint coordinate search', async () => {
    setCloudNoticeEnabled(false);
    const direct = await buildBobTransport(data, layout, options, false);
    const missing = await CpSat.solve(direct.model, { numWorkers: 1, maxTimeInSeconds: 1 });
    expect(missing.hasSolution).toBe(false);
    expect(direct.conflicts(false).some((c) => c.kind === 'space' && c.tiles.length > 0)).toBe(
      true,
    );
    const relay = await buildBobTransport(data, layout, options, true);
    const selected = await CpSat.solve(relay.model, { numWorkers: 1, maxTimeInSeconds: 3 });
    expect(selected.hasSolution).toBe(true);
    const result = relay.read(selected);
    expect(result.nodes.filter((n) => n.kind === 'chest')).toHaveLength(1);
    expect(result.inserters).toHaveLength(3);
    expect(validateBobLayout(problem, result)).toEqual([]);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.inserters).toEqual([]);
  }, 10_000);

  it('distinguishes a timeout diagnostic from a proven space conflict', async () => {
    const transport = await buildBobTransport(data, layout, options, false);
    expect(transport.conflicts(true).every((c) => c.kind === 'timeout')).toBe(true);
    expect(transport.conflicts(false).every((c) => c.kind === 'space')).toBe(true);
    await expect(
      buildBobTransport(data, layout, options, true, undefined, 0),
    ).rejects.toBeInstanceOf(BobTransportTimeout);
  });

  it('chooses adjacent endpoints after flow allocation when their capacity is sufficient', async () => {
    const small: BobLayout = {
      width: 5,
      height: 3,
      nodes: data.nodes.map((n) => ({
        ...n,
        position:
          n.id === 'a' ? { x: 1, y: 0 } : n.kind === 'source' ? { x: 0, y: 0 } : { x: 4, y: 0 },
      })),
      inserters: [],
    };
    const transport = await buildBobTransport(data, small, options, false);
    const selected = await CpSat.solve(transport.model, { numWorkers: 1, maxTimeInSeconds: 1 });
    expect(selected.hasSolution).toBe(true);
    const result = transport.read(selected);
    expect(validateBobLayout(problem, result)).toEqual([]);
    for (const arm of result.inserters) {
      const distance = (p: { x: number; y: number }) =>
        Math.abs(p.x - arm.position.x) + Math.abs(p.y - arm.position.y);
      expect(distance(arm.pickup)).toBe(1);
      expect(distance(arm.dropoff)).toBe(1);
    }
  });
});
