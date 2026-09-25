import { describe, expect, it } from 'vitest';
import { fluidBoxResources } from '../src/components/design/design-scene.tsx';
import { defaultDataset } from '../src/dataset';

describe('the ingested machine geometry', () => {
  it('keeps tile footprints for all production machines', () => {
    for (const [id, machine] of Object.entries(defaultDataset.data.machines)) {
      expect(machine.size.width, `${id} width`).toBeGreaterThan(0);
      expect(machine.size.height, `${id} height`).toBeGreaterThan(0);
    }
    expect(defaultDataset.data.machines['assembling-machine-3'].size).toEqual({
      width: 3,
      height: 3,
    });
    expect(defaultDataset.data.machines['oil-refinery'].size).toEqual({ width: 5, height: 5 });
  });

  it('keeps fluid boxes grouped with their production and connection modes', () => {
    expect(defaultDataset.data.machines['chemical-plant'].fluidBoxes).toEqual([
      {
        productionType: 'input',
        connections: [{ position: { x: -1, y: -1 }, direction: 'north', flowDirection: 'input' }],
      },
      {
        productionType: 'input',
        connections: [{ position: { x: 1, y: -1 }, direction: 'north', flowDirection: 'input' }],
      },
      {
        productionType: 'output',
        connections: [{ position: { x: -1, y: 1 }, direction: 'south', flowDirection: 'output' }],
      },
      {
        productionType: 'output',
        connections: [{ position: { x: 1, y: 1 }, direction: 'south', flowDirection: 'output' }],
      },
    ]);
    expect(defaultDataset.data.machines['assembling-machine-1'].fluidBoxes).toBeUndefined();
  });

  it('maps indexed and unindexed recipe fluids in separate input and output namespaces', () => {
    const resources = fluidBoxResources(defaultDataset.data.machines['chemical-plant'], {
      ingredients: [
        { resource: 'fluid:sulfuric-acid' },
        { resource: 'fluid:water', fluidboxIndex: 2 },
        { resource: 'item:iron-plate' },
      ],
      products: [{ resource: 'fluid:steam', fluidboxIndex: 2 }],
    });

    expect([...resources]).toEqual([
      [1, 'fluid:water'],
      [0, 'fluid:sulfuric-acid'],
      [3, 'fluid:steam'],
    ]);
  });

  it('merges every box on a side for one unindexed fluid', () => {
    const resources = fluidBoxResources(defaultDataset.data.machines['chemical-plant'], {
      ingredients: [
        { resource: 'fluid:angels-gas-oxygen' },
        { resource: 'fluid:angels-gas-nitrogen-monoxide' },
      ],
      products: [{ resource: 'fluid:angels-gas-nitrogen-dioxide' }],
    });

    expect([...resources]).toEqual([
      [0, 'fluid:angels-gas-oxygen'],
      [1, 'fluid:angels-gas-nitrogen-monoxide'],
      [2, 'fluid:angels-gas-nitrogen-dioxide'],
      [3, 'fluid:angels-gas-nitrogen-dioxide'],
    ]);
  });

  it('gives an indivisible extra box to the earlier unindexed fluid', () => {
    const resources = fluidBoxResources(defaultDataset.data.machines['oil-refinery'], {
      ingredients: [{ resource: 'fluid:angels-liquid-vegetable-oil' }],
      products: [
        { resource: 'fluid:angels-liquid-fuel-oil' },
        { resource: 'fluid:angels-liquid-mineral-oil' },
      ],
    });

    expect([...resources]).toEqual([
      [0, 'fluid:angels-liquid-vegetable-oil'],
      [1, 'fluid:angels-liquid-vegetable-oil'],
      [2, 'fluid:angels-liquid-fuel-oil'],
      [3, 'fluid:angels-liquid-fuel-oil'],
      [4, 'fluid:angels-liquid-mineral-oil'],
    ]);
  });
});
