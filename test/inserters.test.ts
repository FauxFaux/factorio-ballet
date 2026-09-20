import { describe, expect, it } from 'vitest';
import { staticData } from '../src/data/decode.ts';

describe('the ingested inserters', () => {
  it("keeps each live prototype's motion, reach and base hand capacity", () => {
    expect(Object.keys(staticData.inserters)).toEqual([
      'inserter',
      'fast-inserter',
      'burner-inserter',
      'bulk-inserter',
      'bob-steam-inserter',
      'bob-express-inserter',
      'bob-express-bulk-inserter',
      'bob-red-inserter',
      'bob-red-bulk-inserter',
      'bob-turbo-inserter',
      'bob-turbo-bulk-inserter',
    ]);
    expect(staticData.inserters['inserter']).toEqual({
      human: 'Inserter',
      item: 'inserter',
      rotationSpeed: 0.02,
      extensionSpeed: 0.05,
      pickupPosition: { x: 0, y: -1 },
      insertPosition: { x: 0, y: 1.2 },
      baseStackSize: 1,
    });
    expect(staticData.inserters['bulk-inserter']).toMatchObject({
      rotationSpeed: 0.06,
      extensionSpeed: 0.15,
      baseStackSize: 2,
      bulk: true,
    });
    expect(staticData.inserters['burner-inserter']?.rotationSpeed).toBe(0.013);
    expect(staticData.inserters['bob-red-inserter']).toMatchObject({
      startingDistance: 0.7,
    });
  });

  it('can join every inserter to the item which places it', () => {
    for (const [id, inserter] of Object.entries(staticData.inserters)) {
      expect(staticData.resources[`item:${inserter.item}`]?.human, id).toBeTruthy();
    }
  });
});
