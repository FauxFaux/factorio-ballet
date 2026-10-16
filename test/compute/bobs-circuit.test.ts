import { describe, expect, it } from 'vitest';
import { CpSat, setCloudNoticeEnabled } from 'or-tools-wasm/cp-sat';
import { bobTransportData } from '../../src/compute/bobs/problem-data.ts';
import { buildBobTransport } from '../../src/compute/bobs/transport.ts';
import { buildBobPlacement } from '../../src/compute/bobs/placement.ts';
import { solveBobLayout } from '../../src/compute/bobs/staged-solver.ts';
import { validateBobLayout } from '../../src/compute/bobs/validate.ts';
import { defaultBobOptions, type BobProblem, type Point } from '../../src/compute/bobs/types.ts';

const problem: BobProblem = {
  machines: [
    ...Array.from({ length: 2 }, (_, i) => ({
      id: `circuit:${i}`,
      label: `Circuit ${i + 1}`,
      size: { width: 3, height: 3 },
      inputs: { 'item:iron-plate': 1.5, 'item:copper-cable': 4.5 },
      outputs: { 'item:electronic-circuit': 1.5 },
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `cable:${i}`,
      label: `Cable ${i + 1}`,
      size: { width: 3, height: 3 },
      inputs: { 'item:copper-plate': 1.5 },
      outputs: { 'item:copper-cable': 3 },
    })),
  ],
  inputs: ['item:copper-plate', 'item:iron-plate'],
  outputs: ['item:electronic-circuit'],
};
const data = bobTransportData(problem);
// Zero-based top-left coordinates; the spare bottom column is x=6.
const positions: Point[] = [
  { x: 0, y: 0 },
  { x: 7, y: 0 },
  { x: 0, y: 3 },
  { x: 3, y: 3 },
  { x: 7, y: 3 },
  { x: 4, y: 0 },
  { x: 3, y: 0 },
  { x: 6, y: 0 },
];
const layout = {
  width: 10,
  height: 6,
  nodes: data.nodes.map((n, i) => ({ ...n, position: positions[i] })),
  inserters: [],
};

describe('Bob classic circuit layout', () => {
  it('finds an eleven-inserter 10×6 layout through unseeded production refinement', async () => {
    const result = await solveBobLayout(problem, {
      maxWidth: 10,
      maxHeight: 6,
      maxInserters: 11,
      maxTimeInSeconds: 10,
    });
    expect(result.status).toBe('feasible');
    expect(validateBobLayout(problem, result.layout!)).toEqual([]);
    expect(result.layout!.width).toBe(10);
    expect(result.layout!.height).toBe(6);
    expect(result.layout!.inserters).toHaveLength(11);
    expect(result.layout!.nodes.some((n) => n.kind === 'chest')).toBe(false);
    expect(
      result.attempts!.some((a) =>
        a.promoted.some((p) => p.resource === 'item:copper-cable' && p.side === 'input'),
      ),
    ).toBe(true);
  }, 15_000);

  it('can promote a circuit cable input without forcing a relay', async () => {
    const port = data.ports.find(
      (p) => p.node === 'circuit:0' && p.resource === 'item:copper-cable',
    )!;
    const placement = buildBobPlacement(
      data,
      {
        ...defaultBobOptions(problem),
        maxWidth: 10,
        maxHeight: 6,
        maxChests: 0,
        maxInserters: 11,
      },
      [port],
      [],
    );
    const selected = await CpSat.solve(placement.model, { numWorkers: 1, maxTimeInSeconds: 2 });
    expect(selected.hasSolution).toBe(true);
    const reserved = placement.read(selected);
    expect(reserved.nodes.some((n) => n.kind === 'chest')).toBe(false);
    expect(reserved.inserters).toHaveLength(2);
    expect(new Set(reserved.inserters.map((a) => a.from)).size).toBe(2);
    expect(reserved.inserters.reduce((n, a) => n + a.rates['item:copper-cable']!, 0)).toBe(4.5);
  });

  it('connects two circuits and three cable assemblers in 10×6 with eleven inserters and no relays', async () => {
    setCloudNoticeEnabled(false);
    const transport = await buildBobTransport(
      data,
      layout,
      {
        ...defaultBobOptions(problem),
        maxWidth: 10,
        maxHeight: 6,
        maxChests: 0,
        maxInserters: 11,
      },
      false,
    );
    const selected = await CpSat.solve(transport.model, { numWorkers: 1, maxTimeInSeconds: 1.5 });
    expect(selected.hasSolution).toBe(true);
    const connected = transport.read(selected);
    expect(validateBobLayout(problem, connected)).toEqual([]);
    expect(connected.inserters).toHaveLength(11);
    expect(connected.nodes.some((n) => n.kind === 'chest')).toBe(false);
    const cableTransfers = connected.inserters.filter((a) => a.rates['item:copper-cable']);
    expect(cableTransfers).toHaveLength(4);
    expect(cableTransfers.map((a) => a.rates['item:copper-cable']).sort((a, b) => a! - b!)).toEqual(
      [1.5, 1.5, 3, 3],
    );
    for (const node of data.nodes.filter((n) => n.kind === 'assembler')) {
      const supply = connected.inserters.filter(
        (a) => a.to === node.id && (a.rates['item:iron-plate'] || a.rates['item:copper-plate']),
      );
      expect(supply).toHaveLength(1);
    }
    expect(layout.inserters).toEqual([]);
  });
});
