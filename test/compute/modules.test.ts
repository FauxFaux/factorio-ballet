import { describe, expect, it } from 'vitest';
import { modulesForTile } from '../../src/compute/modules.ts';
import type { TileDesignCandidate } from '../../src/compute/design-validation/types.ts';
import type { KernelProblem } from '../../src/compute/kernel-problems.ts';

const problem: KernelProblem = {
  inputs: { solids: { 'item:iron': 2 }, fluids: {} },
  outputs: { solids: { 'item:gear': 1 }, fluids: {} },
  assemblers: [],
  design: { columns: [] },
};

const candidate: TileDesignCandidate = {
  width: 5,
  pitch: 3,
  machineIds: { 0: 'machine' },
  column: {
    entities: [
      { kind: 'belt', direction: 'north', position: { x: 0, y: 0 } },
      { kind: 'belt', direction: 'north', position: { x: 0, y: 2 } },
    ],
  },
  lanes: [],
  transfers: [],
  fluids: [],
  boundary: [
    {
      x: 0,
      kind: 'belt',
      direction: 'north',
      lanes: { left: 'item:iron', right: 'item:gear' },
      laneFlows: {
        left: { side: 'input', rate: 2 },
        right: { side: 'output', rate: 1 },
      },
    },
  ],
};

describe('modulesForTile', () => {
  it('balances 28 machines into two modules of 14 when the maximum is 23', () => {
    const modules = modulesForTile('gear', 28, problem, candidate, 23);
    expect(modules.map(({ machineCount, size }) => ({ machineCount, size }))).toEqual([
      { machineCount: 14, size: { width: 5, height: 42 } },
      { machineCount: 14, size: { width: 5, height: 42 } },
    ]);
    expect(modules[0]?.ports).toEqual([
      {
        edge: 'top',
        x: 0,
        transport: 'belt',
        lanes: {
          left: { resource: 'item:iron', side: 'input', rate: 28 },
          right: { resource: 'item:gear', side: 'output', rate: 14 },
        },
      },
      {
        edge: 'bottom',
        x: 0,
        transport: 'belt',
        lanes: {
          left: { resource: 'item:iron', side: 'input', rate: 28 },
          right: { resource: 'item:gear', side: 'output', rate: 14 },
        },
      },
    ]);
    expect(modules[0]?.inputs).toEqual({ 'item:iron': 28 });
    expect(modules[0]?.outputs).toEqual({ 'item:gear': 14 });
  });

  it('records underground pipe and belt ends with fluid throughput', () => {
    const underground = {
      ...candidate,
      column: {
        entities: [
          {
            kind: 'underground-belt' as const,
            direction: 'north' as const,
            end: 'output' as const,
            position: { x: 0, y: 0 },
          },
          {
            kind: 'underground-belt' as const,
            direction: 'north' as const,
            end: 'input' as const,
            position: { x: 0, y: 2 },
          },
          {
            kind: 'underground-pipe' as const,
            direction: 'north' as const,
            position: { x: 4, y: 0 },
          },
          {
            kind: 'underground-pipe' as const,
            direction: 'south' as const,
            position: { x: 4, y: 2 },
          },
        ],
      },
      boundary: [candidate.boundary[0]!, { x: 4, kind: 'pipe' as const, resource: 'fluid:water' }],
    };
    const wetProblem: KernelProblem = {
      ...problem,
      inputs: { ...problem.inputs, fluids: { 'fluid:water': 10 } },
    };
    const module = modulesForTile('gear', 2, wetProblem, underground, 23)[0]!;
    expect(module.ports.map(({ edge, transport }) => [edge, transport])).toEqual([
      ['top', 'underground-belt'],
      ['bottom', 'underground-belt'],
      ['top', 'underground-pipe'],
      ['bottom', 'underground-pipe'],
    ]);
    expect(module.ports[2]?.fluid).toEqual({
      resource: 'fluid:water',
      inputRate: 20,
      outputRate: 0,
    });
  });
});
