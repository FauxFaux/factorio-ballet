import { describe, expect, it } from 'vitest';
import { fluidBoxResources } from '../src/components/design/design-scene.tsx';
import { staticData } from '../src/data/decode.ts';

describe('the ingested machine geometry', () => {
  it('keeps tile footprints for all production machines', () => {
    for (const [id, machine] of Object.entries(staticData.machines)) {
      expect(machine.size.width, `${id} width`).toBeGreaterThan(0);
      expect(machine.size.height, `${id} height`).toBeGreaterThan(0);
    }
    expect(staticData.machines['assembling-machine-3'].size).toEqual({ width: 3, height: 3 });
    expect(staticData.machines['oil-refinery'].size).toEqual({ width: 5, height: 5 });
  });

  it('keeps fluid boxes grouped with their production and connection modes', () => {
    expect(staticData.machines['chemical-plant'].fluidBoxes).toEqual([
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
    expect(staticData.machines['assembling-machine-1'].fluidBoxes).toBeUndefined();
  });

  it('maps indexed and unindexed recipe fluids in separate input and output namespaces', () => {
    const resources = fluidBoxResources(staticData.machines['chemical-plant'], {
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
});
