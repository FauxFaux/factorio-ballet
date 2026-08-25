import { describe, expect, it } from 'vitest';
import { beltTiers, chosenBelt, defaultBelt, staticData } from '../src/data.ts';

describe('the chosen belt', () => {
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

  it('joins every belt to the complexity of the item which places it', () => {
    expect(beltTiers.map(({ id }) => id)).toEqual([
      'bob-basic-transport-belt',
      'transport-belt',
      'fast-transport-belt',
      'express-transport-belt',
      'bob-turbo-transport-belt',
      'bob-ultimate-transport-belt',
    ]);
    for (const { id, belt, complexity } of beltTiers) {
      expect(staticData.resources[`item:${belt.item ?? id}`]?.human, id).toBeTruthy();
      expect(complexity, id).toBeGreaterThan(0);
    }
  });

  it('defaults to the fastest researched belt and lets the header pin or remove it', () => {
    expect(defaultBelt(0)).toBeUndefined();
    expect(defaultBelt(1)?.id).toBe('bob-ultimate-transport-belt');
    expect(chosenBelt('transport-belt', 1)).toBe(staticData.belts['transport-belt']);
    expect(chosenBelt(null, 1)).toBeUndefined();
    expect(chosenBelt(undefined, 1)).toBe(staticData.belts['bob-ultimate-transport-belt']);
  });
});
