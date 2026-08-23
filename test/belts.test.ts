import { describe, expect, it } from 'vitest';
import { staticData } from '../src/data.ts';

describe('the ingested belts', () => {
  it('is the six tiers the pack has, in items per second', () => {
    expect(
      Object.fromEntries(Object.entries(staticData.belts).map(([id, b]) => [id, b.itemsPerSecond])),
    ).toEqual({
      'bob-basic-transport-belt': 7.5,
      'transport-belt': 15,
      'fast-transport-belt': 30,
      'express-transport-belt': 45,
      'bob-turbo-transport-belt': 60,
      'bob-ultimate-transport-belt': 75,
    });
  });

  it('names an item which is in the data, for the icon and the name and the complexity', () => {
    for (const [id, belt] of Object.entries(staticData.belts)) {
      expect(staticData.resources[`item:${belt.item}`], id).toBeDefined();
      expect(belt.human, id).toBeTruthy();
    }
  });
});
