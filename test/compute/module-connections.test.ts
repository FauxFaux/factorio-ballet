import { describe, expect, it } from 'vitest';
import { allocateModuleFlows } from '../../src/compute/module-connections.ts';
import type { FactoryModule } from '../../src/compute/modules.ts';
import type { ResourceId } from '../../src/types.ts';

function module(
  id: string,
  inputs: Partial<Record<ResourceId, number>>,
  outputs: Partial<Record<ResourceId, number>>,
): FactoryModule {
  return {
    id,
    recipe: id,
    machineCount: 1,
    copies: 1,
    size: { width: 3, height: 3 },
    ports: [],
    inputs: inputs as Record<ResourceId, number>,
    outputs: outputs as Record<ResourceId, number>,
  };
}

describe('allocateModuleFlows', () => {
  it('connects a five-per-second consumer to two three-per-second producers', () => {
    const result = allocateModuleFlows(
      [
        module('A', { 'item:1': 5 }, {}),
        module('B:0', {}, { 'item:1': 3 }),
        module('B:1', {}, { 'item:1': 3 }),
      ],
      ['item:1'],
    );
    expect(result.connections).toEqual([
      { producerId: 'B:0', consumerId: 'A', resource: 'item:1', rate: 3 },
      { producerId: 'B:1', consumerId: 'A', resource: 'item:1', rate: 2 },
    ]);
    expect(result.unmetInputs).toEqual([]);
    expect(result.unusedOutputs).toEqual([{ moduleId: 'B:1', resource: 'item:1', rate: 1 }]);
  });

  it('finds external matches for a module that also produces its own ingredient', () => {
    const result = allocateModuleFlows(
      [
        module('A', { 'fluid:1': 4 }, { 'fluid:1': 4 }),
        module('B', { 'fluid:1': 4 }, { 'fluid:1': 4 }),
      ],
      ['fluid:1'],
    );
    expect(result.connections).toEqual([
      { producerId: 'A', consumerId: 'B', resource: 'fluid:1', rate: 4 },
      { producerId: 'B', consumerId: 'A', resource: 'fluid:1', rate: 4 },
    ]);
    expect(result.unmetInputs).toEqual([]);
    expect(result.unusedOutputs).toEqual([]);
  });

  it('keeps rates without an internal counterpart for later station routing', () => {
    const result = allocateModuleFlows(
      [module('A', { 'item:ore': 2 }, { 'item:plate': 1 })],
      ['item:ore', 'item:plate'],
    );
    expect(result.connections).toEqual([]);
    expect(result.unmetInputs).toEqual([{ moduleId: 'A', resource: 'item:ore', rate: 2 }]);
    expect(result.unusedOutputs).toEqual([{ moduleId: 'A', resource: 'item:plate', rate: 1 }]);
  });
});
