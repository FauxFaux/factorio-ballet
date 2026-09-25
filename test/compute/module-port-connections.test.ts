import { describe, expect, it } from 'vitest';
import { allocateModuleFlows, connectStationFlows } from '../../src/compute/module-connections.ts';
import { assignModulePorts } from '../../src/compute/module-port-connections.ts';
import type { FactoryModule, ModulePort } from '../../src/compute/modules.ts';
import { modulesForTile, recipeKernelProblem } from '../../src/compute/modules.ts';
import { solveKernelTileDesign } from '../../src/compute/tile-design/kernel-result.ts';
import { portPoint } from '../../src/components/layout/spring-layout.ts';
import type { ResourceId } from '../../src/types.ts';
import { defaultDataset } from '../with-bobang.ts';

function module(id: string, input: number, output: number, ports: ModulePort[]): FactoryModule {
  return {
    id,
    recipe: id,
    machineCount: 1,
    copies: 1,
    size: { width: 4, height: 3 },
    ports,
    inputs: input ? ({ 'item:1': input } as Record<ResourceId, number>) : {},
    outputs: output ? ({ 'item:1': output } as Record<ResourceId, number>) : {},
  };
}

function beltPort(
  edge: 'top' | 'bottom',
  x: number,
  side: 'input' | 'output',
  left: number,
  right = 0,
): ModulePort {
  return {
    edge,
    x,
    transport: 'belt',
    direction: 'north',
    lanes: {
      ...(left ? { left: { resource: 'item:1', side, rate: left } } : {}),
      ...(right ? { right: { resource: 'item:1', side, rate: right } } : {}),
    },
  };
}

describe('assignModulePorts', () => {
  it('attaches both fluid products from air separation to their stations', () => {
    const recipeId = 'angels-air-separation';
    const recipe = defaultDataset.data.recipes[recipeId]!;
    const problem = recipeKernelProblem(
      defaultDataset.data,
      recipeId,
      'chemical-plant',
      new Map(recipe.ingredients.map(({ resource, amount }) => [resource, amount as number])),
      new Map(recipe.products.map(({ resource }) => [resource, 50])),
    );
    const result = solveKernelTileDesign(problem, {
      beltItemsPerSecond: 75,
      inserterItemsPerSecond: 15,
      longInserterItemsPerSecond: 15,
    });
    expect(result).toHaveProperty('status', 'found');
    if (!('status' in result) || result.status !== 'found') return;
    const modules = modulesForTile(
      recipeId,
      4,
      problem,
      result.candidate,
      result.validation.supportedCopies,
    );
    const outputs = recipe.products.map(({ resource }) => resource);
    const logical = connectStationFlows(
      allocateModuleFlows(
        modules,
        recipe.ingredients.map(({ resource }) => resource).concat(outputs),
      ),
      recipe.ingredients.map(({ resource }) => resource),
      outputs,
    );
    const assigned = assignModulePorts(modules, logical);
    expect(
      assigned.stationConnections
        .filter(({ side }) => side === 'output')
        .map(({ resource }) => resource),
    ).toEqual([outputs[0], outputs[1], outputs[1]]);
    expect(
      assigned.stationConnections
        .filter(({ resource }) => resource === outputs[1])
        .map(({ modulePort }) => modulePort),
    ).toEqual([
      { edge: 'left', x: 0, y: 2, transport: 'pipe' },
      { edge: 'left', x: 0, y: 8, transport: 'pipe' },
    ]);
    expect(
      assigned.stationConnections
        .filter(({ resource }) => resource === outputs[1])
        .map(({ modulePort }) => portPoint({ module: modules[0]!, x: 10, y: 20 }, modulePort)),
    ).toEqual([
      { x: 10, y: 22.5 },
      { x: 10, y: 28.5 },
    ]);
    expect(assigned.unattached).toEqual([]);
  });
  it('splits connections across lanes and uses the exposed output and input edges', () => {
    const modules = [
      module('A', 5, 0, [beltPort('top', 0, 'input', 2, 3), beltPort('bottom', 0, 'input', 2, 3)]),
      module('B:0', 0, 3, [beltPort('top', 1, 'output', 3), beltPort('bottom', 1, 'output', 3)]),
      module('B:1', 0, 3, [beltPort('top', 1, 'output', 3), beltPort('bottom', 1, 'output', 3)]),
    ];
    const logical = connectStationFlows(allocateModuleFlows(modules, ['item:1']), [], []);
    const assigned = assignModulePorts(modules, logical);
    expect(
      assigned.connections.map(({ producerId, rate, producerPort, consumerPort }) => ({
        producerId,
        rate,
        producerPort,
        consumerPort,
      })),
    ).toEqual([
      {
        producerId: 'B:0',
        rate: 2,
        producerPort: { edge: 'top', x: 1, transport: 'belt', direction: 'north', lane: 'left' },
        consumerPort: { edge: 'bottom', x: 0, transport: 'belt', direction: 'north', lane: 'left' },
      },
      {
        producerId: 'B:0',
        rate: 1,
        producerPort: { edge: 'top', x: 1, transport: 'belt', direction: 'north', lane: 'left' },
        consumerPort: {
          edge: 'bottom',
          x: 0,
          transport: 'belt',
          direction: 'north',
          lane: 'right',
        },
      },
      {
        producerId: 'B:1',
        rate: 2,
        producerPort: { edge: 'top', x: 1, transport: 'belt', direction: 'north', lane: 'left' },
        consumerPort: {
          edge: 'bottom',
          x: 0,
          transport: 'belt',
          direction: 'north',
          lane: 'right',
        },
      },
    ]);
    expect(assigned.unattached).toEqual([]);
  });

  it('attaches station flows to the same port budgets without counting both ends twice', () => {
    const modules = [
      module('A', 4, 0, [beltPort('top', 0, 'input', 2, 2), beltPort('bottom', 0, 'input', 2, 2)]),
    ];
    const logical = connectStationFlows(allocateModuleFlows(modules, ['item:1']), ['item:1'], []);
    const assigned = assignModulePorts(modules, logical);
    expect(
      assigned.stationConnections.map(({ rate, modulePort }) => ({ rate, modulePort })),
    ).toEqual([
      {
        rate: 2,
        modulePort: { edge: 'bottom', x: 0, transport: 'belt', direction: 'north', lane: 'left' },
      },
      {
        rate: 2,
        modulePort: { edge: 'bottom', x: 0, transport: 'belt', direction: 'north', lane: 'right' },
      },
    ]);
    expect(assigned.unattached).toEqual([]);
  });

  it('retains a flow when no matching physical port exists', () => {
    const modules = [module('A', 2, 0, [])];
    const logical = connectStationFlows(allocateModuleFlows(modules, ['item:1']), ['item:1'], []);
    const assigned = assignModulePorts(modules, logical);
    expect(assigned.stationConnections).toEqual([]);
    expect(assigned.unattached).toEqual([
      {
        kind: 'station',
        connection: {
          stationId: 'station:import:item:1',
          stationIndex: 0,
          moduleId: 'A',
          resource: 'item:1',
          rate: 2,
          side: 'input',
        },
      },
    ]);
  });

  it('attaches fluid links to the matching underground pipe endpoints', () => {
    const producer: FactoryModule = {
      ...module('B', 0, 0, []),
      outputs: { 'fluid:water': 10 },
      ports: [
        {
          edge: 'top',
          x: 3,
          transport: 'underground-pipe',
          direction: 'north',
          fluid: { resource: 'fluid:water', inputRate: 0, outputRate: 10 },
        },
        {
          edge: 'bottom',
          x: 3,
          transport: 'pipe',
          fluid: { resource: 'fluid:water', inputRate: 0, outputRate: 10 },
        },
      ],
    };
    const consumer: FactoryModule = {
      ...module('A', 0, 0, []),
      inputs: { 'fluid:water': 10 },
      ports: [
        {
          edge: 'top',
          x: 0,
          transport: 'pipe',
          fluid: { resource: 'fluid:water', inputRate: 10, outputRate: 0 },
        },
        {
          edge: 'bottom',
          x: 0,
          transport: 'underground-pipe',
          direction: 'south',
          fluid: { resource: 'fluid:water', inputRate: 10, outputRate: 0 },
        },
      ],
    };
    const logical = connectStationFlows(
      allocateModuleFlows([producer, consumer], ['fluid:water']),
      [],
      [],
    );
    const assigned = assignModulePorts([producer, consumer], logical);
    expect(assigned.connections).toMatchObject([
      {
        rate: 10,
        producerPort: { edge: 'top', x: 3, transport: 'underground-pipe', direction: 'north' },
        consumerPort: { edge: 'bottom', x: 0, transport: 'underground-pipe', direction: 'south' },
      },
    ]);
  });
});
