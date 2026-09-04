import { describe, expect, it } from 'vitest';
import { staticData } from '../src/data/index.ts';

describe('the ingested machine geometry', () => {
  it('keeps tile footprints for all production machines', () => {
    for (const [id, machine] of Object.entries(staticData.machines)) {
      expect(machine.size.width, `${id} width`).toBeGreaterThan(0);
      expect(machine.size.height, `${id} height`).toBeGreaterThan(0);
    }
    expect(staticData.machines['assembling-machine-3'].size).toEqual({ width: 3, height: 3 });
    expect(staticData.machines['oil-refinery'].size).toEqual({ width: 5, height: 5 });
  });

  it('flattens every fluid-box pipe endpoint into a centre-relative point', () => {
    expect(staticData.machines['chemical-plant'].fluidboxConnectionPoints).toEqual([
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(staticData.machines['assembling-machine-1'].fluidboxConnectionPoints).toBeUndefined();
  });
});
