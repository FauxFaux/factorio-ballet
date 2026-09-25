import { describe, expect, it } from 'vitest';
import { staticDs } from '../src/data/decode.ts';

describe('the ingested inserters', () => {
  it("keeps each live prototype's motion, reach and base hand capacity", () => {
    expect(Object.keys(staticDs.data.inserters)).toEqual([
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
    expect(staticDs.data.inserters['inserter']).toEqual({
      human: 'Inserter',
      item: 'inserter',
      rotationSpeed: 0.02,
      extensionSpeed: 0.05,
      pickupPosition: { x: 0, y: -1 },
      insertPosition: { x: 0, y: 1.2 },
      baseStackSize: 1,
    });
    expect(staticDs.data.inserters['bulk-inserter']).toMatchObject({
      rotationSpeed: 0.06,
      extensionSpeed: 0.15,
      baseStackSize: 2,
      bulk: true,
    });
    expect(staticDs.data.inserters['burner-inserter']?.rotationSpeed).toBe(0.013);
    expect(staticDs.data.inserters['bob-red-inserter']).toMatchObject({
      startingDistance: 0.7,
    });
  });

  it('can join every inserter to the item which places it', () => {
    for (const [id, inserter] of Object.entries(staticDs.data.inserters)) {
      expect(staticDs.data.resources[`item:${inserter.item}`]?.human, id).toBeTruthy();
    }
  });

  it('puts finite hand-capacity research on the same game-progress scale as everything else', () => {
    expect(staticDs.data.inserterCapacityBonuses).toEqual([
      [0.2711, 1, 0],
      [0.3125, 1, 1],
      [0.3277, 1, 2],
      [0.3391, 1, 3],
      [0.4841, 2, 3],
      [0.508, 2, 4],
      [0.5259, 2, 5],
      [0.6867, 3, 5],
      [0.6973, 3, 7],
      [0.7192, 3, 9],
      [0.7363, 4, 9],
      [0.757, 4, 11],
    ]);
  });
});
