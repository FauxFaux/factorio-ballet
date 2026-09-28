import { describe, expect, it } from 'vitest';
import { defaultDataset } from './with-bobang.ts';

describe('ingested burner data', () => {
  const data = defaultDataset.data;

  it('keeps machine power, effectivity and fuel category IDs', () => {
    expect(data.machines['angels-blast-furnace-3'].burner).toEqual({
      power: 0.25,
      effectivity: 1,
      fuelCategories: ['chemical'],
    });
    expect(data.machines['assembling-machine-3'].burner).toBeUndefined();
    expect(Object.values(data.machines).filter((machine) => machine.burner)).toHaveLength(9);
  });

  it('keeps item fuel values and spent results', () => {
    expect(data.resources['item:angels-solid-carbon']).toMatchObject({
      fuelValue: 3,
      fuelCategory: 'chemical',
    });
    expect(data.resources['item:uranium-fuel-cell']).toMatchObject({
      fuelValue: 2000,
      fuelCategory: 'nuclear',
      burntResult: 'item:depleted-uranium-fuel-cell',
    });
    expect(
      Object.values(data.resources).filter((resource) => resource.fuelCategory === 'chemical'),
    ).toHaveLength(17);
  });
});
