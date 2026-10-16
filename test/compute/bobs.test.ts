import { describe, expect, it } from 'vitest';
import { CpSat, setCloudNoticeEnabled } from 'or-tools-wasm/cp-sat';
import { buildBobModel, solveBobLayout } from '../../src/compute/bobs/bobs-solver.ts';
import { bobCapacity, bobCycleSeconds, bobSwings } from '../../src/compute/bobs/geometry.ts';
import { validateBobLayout } from '../../src/compute/bobs/validate.ts';
import { bobProblem } from '../../src/compute/bobs/problem.ts';
import type { BobLayout, BobProblem } from '../../src/compute/bobs/types.ts';
import { defaultDataset } from '../with-bobang.ts';
import { noChoice } from '../../src/data/index.ts';
import { solveCell } from '../../src/solve/index.ts';
import { defaultBobOptions } from '../../src/compute/bobs/types.ts';
import { cellInterface, type Cell } from '../../src/cell.ts';

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
const bounds = { maxWidth: 8, maxHeight: 8, maxChests: 0, maxInserters: 4, maxTimeInSeconds: 3 };

describe('Bob inserter geometry', () => {
  it('includes the return swing, with no pickup or drop delay', () => {
    expect(bobCapacity({ x: 1, y: 0 }, { x: -1, y: 0 })).toBe(144);
    expect(bobCapacity({ x: 2, y: 0 }, { x: 0, y: 2 })).toBe(288);
    expect(bobCapacity({ x: 2, y: 1 }, { x: 1, y: 2 })).toBeCloseTo(703.012529, 6);
    expect(Math.max(...bobSwings().map((s) => s.capacity))).toBeCloseTo(703.012529, 6);
  });

  it('allows pure extension and includes the retraction on the return trip', () => {
    expect(bobCycleSeconds({ x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(1 / 3);
    expect(bobCapacity({ x: 1, y: 0 }, { x: 2, y: 0 })).toBe(72);
    expect(bobCapacity({ x: 2, y: 0 }, { x: 1, y: 0 })).toBe(72);
  });

  it('uses the longer simultaneous motion when extension takes longer', () => {
    // 26.565° takes 0.0123s; sqrt(5) - 2 tiles of extension takes 0.0393s.
    expect(bobCycleSeconds({ x: 2, y: 0 }, { x: 2, y: 1 })).toBeCloseTo(0.078689326, 9);
    expect(bobCapacity({ x: 2, y: 0 }, { x: 2, y: 1 })).toBeCloseTo(304.996894, 6);
  });

  it('hides a small length change behind a longer rotation', () => {
    // 153.435° takes 0.0710s, longer than the same 0.0393s extension.
    expect(bobCycleSeconds({ x: 2, y: 0 }, { x: -2, y: 1 })).toBeCloseTo(0.142069397, 9);
    expect(bobCapacity({ x: 2, y: 0 }, { x: -2, y: 1 })).toBeCloseTo(168.931526, 6);
  });

  it('precomputes every distinct reachable endpoint pair with symmetric trip times', () => {
    expect(bobSwings()).toHaveLength(552);
    for (const swing of bobSwings()) {
      expect(swing.cycleSeconds).toBeGreaterThan(0);
      expect(swing.capacity * swing.cycleSeconds).toBeCloseTo(24);
      expect(bobCycleSeconds(swing.dropoff, swing.pickup)).toBeCloseTo(swing.cycleSeconds);
    }
  });

  it('rejects out-of-reach, non-tile and coincident endpoints', () => {
    expect(bobCapacity({ x: 2, y: 2 }, { x: -2, y: 2 })).toBe(0);
    expect(bobCapacity({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(bobCapacity({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(bobCapacity({ x: 1, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(bobCapacity({ x: 1.5, y: 0 }, { x: 0, y: 1.5 })).toBe(0);
  });
});

describe('Bob CP-SAT layout', () => {
  it('packs every machine and real transport into a minimum perimeter rectangle', async () => {
    const result = await solveBobLayout(problem, bounds);
    expect(result.status).toBe('optimal');
    expect(result.layout!.width + result.layout!.height).toBe(8);
    expect(result.layout!.inserters).toHaveLength(2);
    expect(validateBobLayout(problem, result.layout!)).toEqual([]);
    const broken = structuredClone(result.layout!);
    broken.inserters[0].position = { ...broken.nodes[0].position };
    expect(validateBobLayout(problem, broken)).not.toEqual([]);
  }, 20_000);

  it('adds parallel inserters when one cannot carry the requested rate', async () => {
    const high = structuredClone(problem);
    high.machines[0].inputs['item:iron'] = 800;
    expect((await solveBobLayout(high, { ...bounds, maxInserters: 2 })).status).toBe('infeasible');
    const result = await solveBobLayout(high, bounds);
    expect(result.layout).toBeDefined();
    const feeders = result.layout!.inserters.filter((i) => i.from === 'source:item:iron');
    expect(feeders.length).toBeGreaterThanOrEqual(2);
    expect(feeders.reduce((n, i) => n + (i.rates['item:iron'] ?? 0), 0)).toBeCloseTo(800);
    expect(validateBobLayout(high, result.layout!)).toEqual([]);
  }, 20_000);

  it('places a separate boundary chest for each resource on each side', async () => {
    const mixed = structuredClone(problem);
    mixed.inputs.push('item:copper');
    mixed.outputs.push('item:scrap');
    mixed.machines[0].inputs['item:copper'] = 2;
    mixed.machines[0].outputs['item:scrap'] = 0.25;
    const result = await solveBobLayout(mixed, { ...bounds, maxInserters: 6 });
    expect(result.layout).toBeDefined();
    expect(result.layout!.nodes.filter((n) => n.kind === 'source')).toHaveLength(2);
    expect(result.layout!.nodes.filter((n) => n.kind === 'sink')).toHaveLength(2);
    expect(validateBobLayout(mixed, result.layout!)).toEqual([]);
  }, 20_000);

  it('preserves separate input and output obligations for returned catalysts', async () => {
    const catalyst = structuredClone(problem);
    catalyst.machines[0].outputs['item:iron'] = 0.5;
    const result = await solveBobLayout(catalyst, { ...bounds, maxChests: 1, maxInserters: 6 });
    expect(result.layout).toBeDefined();
    const incoming = result
      .layout!.inserters.filter((i) => i.to === 'a')
      .reduce((n, i) => n + (i.rates['item:iron'] ?? 0), 0);
    const outgoing = result
      .layout!.inserters.filter((i) => i.from === 'a')
      .reduce((n, i) => n + (i.rates['item:iron'] ?? 0), 0);
    expect(incoming).toBeCloseTo(1);
    expect(outgoing).toBeCloseTo(0.5);
  }, 20_000);

  it('allows extension into a shared relay chest, conserving each resource', async () => {
    const branching: BobProblem = {
      machines: ['a', 'b'].map((id) => ({
        id,
        label: id,
        size: { width: 1, height: 1 },
        inputs: { 'item:iron': 1 },
        outputs: { 'item:gear': 1 },
      })),
      inputs: ['item:iron'],
      outputs: ['item:gear'],
    };
    const built = buildBobModel(branching, {
      maxWidth: 6,
      maxHeight: 3,
      maxChests: 1,
      maxInserters: 5,
    });
    const positions = [
      { x: 3, y: 1 },
      { x: 4, y: 2 },
      // The incoming arm at (1,0) picks up at radius sqrt(2) and drops at radius 1.
      { x: 0, y: 1 },
      { x: 5, y: 1 },
      { x: 2, y: 0 },
    ];
    built.nodes.forEach((node, i) => {
      built.model.add(node.x.eq(positions[i].x));
      built.model.add(node.y.eq(positions[i].y));
      built.model.add(node.present.eq(1));
    });
    const transfers = [
      {
        position: { x: 1, y: 0 },
        pickup: positions[2],
        dropoff: positions[4],
        from: 2,
        to: 4,
        rates: { 'item:iron': 2 },
      },
      {
        position: { x: 2, y: 1 },
        pickup: positions[4],
        dropoff: positions[0],
        from: 4,
        to: 0,
        rates: { 'item:iron': 1 },
      },
      {
        position: { x: 2, y: 2 },
        pickup: positions[4],
        dropoff: positions[1],
        from: 4,
        to: 1,
        rates: { 'item:iron': 1 },
      },
      {
        position: { x: 4, y: 1 },
        pickup: positions[0],
        dropoff: positions[3],
        from: 0,
        to: 3,
        rates: { 'item:gear': 1 },
      },
      {
        position: { x: 5, y: 2 },
        pickup: positions[1],
        dropoff: positions[3],
        from: 1,
        to: 3,
        rates: { 'item:gear': 1 },
      },
    ];
    built.slots.forEach((slot, i) => {
      const transfer = transfers[i];
      built.model.add(slot.base.present.eq(1));
      built.model.add(slot.base.x.eq(transfer.position.x));
      built.model.add(slot.base.y.eq(transfer.position.y));
      built.model.add(slot.px.eq(transfer.pickup.x));
      built.model.add(slot.py.eq(transfer.pickup.y));
      built.model.add(slot.dx.eq(transfer.dropoff.x));
      built.model.add(slot.dy.eq(transfer.dropoff.y));
      built.model.add(slot.from[transfer.from].eq(1));
      built.model.add(slot.to[transfer.to].eq(1));
    });
    setCloudNoticeEnabled(false);
    const result = await CpSat.solve(built.model, { numWorkers: 1, maxTimeInSeconds: 2 });
    expect(result.hasSolution).toBe(true);
    const layout: BobLayout = {
      width: 6,
      height: 3,
      nodes: built.definitions.map((d, i) => ({
        id: d.id,
        label: d.label,
        kind: d.kind,
        resource: d.resource,
        size: d.size,
        position: positions[i],
      })),
      inserters: transfers.map((t) => ({
        ...t,
        from: built.definitions[t.from].id,
        to: built.definitions[t.to].id,
        capacity: bobCapacity(
          { x: t.pickup.x - t.position.x, y: t.pickup.y - t.position.y },
          { x: t.dropoff.x - t.position.x, y: t.dropoff.y - t.position.y },
        ),
      })),
    };
    expect(validateBobLayout(branching, layout)).toEqual([]);
    // Removing an outgoing arm cannot be hidden by netting all resources at the chest.
    layout.inserters.splice(1, 1);
    expect(validateBobLayout(branching, layout).some((e) => e.includes('flow mismatch'))).toBe(
      true,
    );
  }, 20_000);

  it('distinguishes exhausted search time from proven infeasibility', async () => {
    const impossible = await solveBobLayout(problem, { ...bounds, maxWidth: 3, maxHeight: 3 });
    expect(impossible.status).toBe('infeasible');
    const timed = await solveBobLayout(problem, { ...bounds, maxTimeInSeconds: 0.000001 });
    expect(timed.status).toBe('unknown');
    expect(timed.message).toContain('feasibility is unknown');
  }, 20_000);

  it('assumes fluid connections are satisfied while preserving item transport', async () => {
    const fluid = structuredClone(problem);
    fluid.machines[0].inputs['fluid:water'] = 100;
    fluid.machines[0].outputs['fluid:steam'] = 200;
    fluid.inputs.push('fluid:water');
    fluid.outputs.push('fluid:steam');
    const result = await solveBobLayout(fluid, bounds);
    expect(result.layout).toBeDefined();
    expect(validateBobLayout(fluid, result.layout!)).toEqual([]);
    expect(
      result
        .layout!.nodes.filter((n) => n.kind === 'source' || n.kind === 'sink')
        .map((n) => n.resource)
        .sort(),
    ).toEqual(['item:gear', 'item:iron']);
    expect(
      result.layout!.inserters.every((i) =>
        Object.keys(i.rates).every((r) => r.startsWith('item:')),
      ),
    ).toBe(true);
    expect(fluid.machines[0].inputs['fluid:water']).toBe(100);
    expect(defaultBobOptions(fluid)).toEqual(defaultBobOptions(problem));
  }, 20_000);

  it('packs fluid-only machines without requiring chests or inserters', async () => {
    const fluid: BobProblem = {
      machines: [
        {
          id: 'a',
          label: 'Fluid machine',
          size: { width: 3, height: 3 },
          inputs: { 'fluid:water': 100 },
          outputs: { 'fluid:steam': 200 },
        },
      ],
      inputs: ['fluid:water'],
      outputs: ['fluid:steam'],
    };
    const result = await solveBobLayout(fluid, {
      ...bounds,
      maxWidth: 3,
      maxHeight: 3,
      maxInserters: 0,
    });
    expect(result.status).toBe('optimal');
    expect(result.layout!.nodes).toHaveLength(1);
    expect(result.layout!.nodes[0].kind).toBe('assembler');
    expect(result.layout!.inserters).toEqual([]);
    expect(validateBobLayout(fluid, result.layout!)).toEqual([]);
  }, 20_000);
});

describe('Bob cell adapter', () => {
  it('accepts fluid recipes and retains their machines and item rates', () => {
    const cell: Cell = { entries: [{ recipe: 'angels-solid-sulfur', count: 1 }] };
    const chosen = noChoice(defaultDataset);
    const solution = solveCell(defaultDataset, defaultDataset.data, cell, 0, chosen);
    const iface = cellInterface(defaultDataset.data, cell, {
      ds: defaultDataset,
      progress: 0,
      chosen,
    });
    expect([...solution.inputRates[0].keys()].some((r) => r.startsWith('fluid:'))).toBe(true);
    const actual = bobProblem(defaultDataset, cell, solution, 0, iface.inputs, iface.outputs);
    expect(actual.machines).toHaveLength(1);
    expect(actual.machines[0].inputs).toEqual({});
    expect(actual.machines[0].outputs['item:sulfur']).toBe(
      solution.outputRates[0].get('item:sulfur'),
    );
    expect(actual.inputs).toEqual([]);
    expect(actual.outputs).toEqual(['item:sulfur']);
  });

  it('places ceil machine counts while retaining the solved fractional load', () => {
    const cell = { entries: [{ recipe: 'copper-cable', count: 2.5 }] };
    const solution = solveCell(
      defaultDataset,
      defaultDataset.data,
      cell,
      0,
      noChoice(defaultDataset),
    );
    const actual = bobProblem(
      defaultDataset,
      cell,
      solution,
      0,
      ['item:copper-plate'],
      ['item:copper-cable'],
    );
    expect(actual.machines).toHaveLength(3);
    const rate = solution.inputRates[0].get('item:copper-plate')!;
    expect(actual.machines.reduce((n, m) => n + m.inputs['item:copper-plate']!, 0)).toBeCloseTo(
      rate * 2.5,
    );
    expect(actual.machines[2].inputs['item:copper-plate']).toBeCloseTo(rate / 2);
  });
});
