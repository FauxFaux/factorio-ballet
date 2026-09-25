import { describe, expect, it } from 'vitest';
import { estimatedModulesForRecipe, modulesForTile } from '../../src/compute/modules.ts';
import { allocateModuleFlows, connectStationFlows } from '../../src/compute/module-connections.ts';
import { assignModulePorts } from '../../src/compute/module-port-connections.ts';
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
        direction: 'north',
        lanes: {
          left: { resource: 'item:iron', side: 'input', rate: 28 },
          right: { resource: 'item:gear', side: 'output', rate: 14 },
        },
      },
      {
        edge: 'bottom',
        x: 0,
        transport: 'belt',
        direction: 'north',
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

  it('scales rates by both machines in a two-machine repeating tile', () => {
    const pair = {
      ...candidate,
      machineIds: { 0: 'machine', 1: 'machine' },
      boundary: [
        {
          ...candidate.boundary[0]!,
          laneFlows: {
            left: { side: 'input' as const, rate: 4 },
            right: { side: 'output' as const, rate: 2 },
          },
        },
      ],
    };
    const modules = modulesForTile('gear', 4, problem, pair, 23);
    expect(modules).toHaveLength(1);
    expect(modules[0]?.machineCount).toBe(4);
    expect(modules[0]?.inputs).toEqual({ 'item:iron': 8 });
    expect(modules[0]?.outputs).toEqual({ 'item:gear': 4 });
    expect(modules[0]?.ports[0]?.lanes?.left?.rate).toBe(8);
  });
});

describe('estimatedModulesForRecipe', () => {
  it('sizes and splits a stack by its allocated belt throughput and exposes regular ports', () => {
    const estimated = estimatedModulesForRecipe(
      'gear',
      9,
      {
        ...problem,
        inputs: { solids: { 'item:iron': 10 }, fluids: { 'fluid:water': 40 } },
        outputs: { solids: { 'item:gear': 4 }, fluids: { 'fluid:steam': 20 } },
        assemblers: [
          { name: 'gear', size: { width: 3, height: 3 }, inputPerSecond: {}, outputPerSecond: {} },
        ],
      },
      30,
    );
    expect(estimated.map(({ machineCount, size }) => ({ machineCount, size }))).toEqual([
      { machineCount: 3, size: { width: 9, height: 15 } },
      { machineCount: 3, size: { width: 9, height: 15 } },
      { machineCount: 3, size: { width: 9, height: 15 } },
    ]);
    expect(estimated[0]).toMatchObject({
      estimated: true,
      inputs: { 'item:iron': 30, 'fluid:water': 120 },
      outputs: { 'item:gear': 12, 'fluid:steam': 60 },
      ports: [
        { edge: 'bottom', x: 1, lanes: { left: { rate: 15 }, right: { rate: 15 } } },
        { edge: 'bottom', x: 2, fluid: { inputRate: 120 } },
        { edge: 'top', x: 3, lanes: { left: { rate: 12 } } },
        { edge: 'top', x: 4, fluid: { outputRate: 60 } },
      ],
    });
    const allocation = connectStationFlows(
      allocateModuleFlows(estimated, ['item:iron', 'fluid:water', 'item:gear', 'fluid:steam']),
      ['item:iron', 'fluid:water'],
      ['item:gear', 'fluid:steam'],
    );
    const assigned = assignModulePorts(estimated, allocation);
    expect(assigned.unattached).toEqual([]);
    expect(assigned.stationConnections).toHaveLength(15);
  });

  it('allocates more than one belt when one assembler exceeds belt throughput', () => {
    const estimated = estimatedModulesForRecipe(
      'gear',
      2,
      { ...problem, inputs: { solids: { 'item:iron': 40 }, fluids: {} } },
      30,
    );
    expect(estimated).toHaveLength(2);
    expect(estimated[0]?.size.width).toBe(8);
    expect(estimated[0]?.ports.slice(0, 2).map((port) => port.lanes)).toEqual([
      {
        left: { resource: 'item:iron', side: 'input', rate: 15 },
        right: { resource: 'item:iron', side: 'input', rate: 15 },
      },
      { left: { resource: 'item:iron', side: 'input', rate: 10 } },
    ]);
  });
});
