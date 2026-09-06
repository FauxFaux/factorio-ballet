import { describe, expect, it } from 'vitest';
import { isBarrelling, isSynthetic, isUnbarrelling, isVoid } from '../src/data/recipes.ts';
import { staticData } from '../src/data/index.ts';

describe('recipe kinds', () => {
  it('detects void recipes', () => {
    expect(
      isVoid({
        ingredients: [{ resource: 'fluid:water', amount: 1 }],
        products: [{ resource: 'fluid:water', amount: { fixed: 1 }, probability: 0.5 }],
        duration: 1,
        categories: ['void'],
      }),
    ).toBe(true);
    expect(isVoid(staticData.recipes['water-barrel'])).toBe(false);
  });

  it('detects both directions of barrelling', () => {
    expect(isBarrelling(staticData.recipes['water-barrel'])).toBe(true);
    expect(isUnbarrelling(staticData.recipes['water-barrel'])).toBe(false);
    expect(isUnbarrelling(staticData.recipes['empty-water-barrel'])).toBe(true);
    expect(isBarrelling(staticData.recipes['empty-water-barrel'])).toBe(false);
  });

  it('detects synthetic recipes from their explicit marker', () => {
    expect(isSynthetic(staticData.recipes['synthetic:pumping-water'])).toBe(true);
    expect(isSynthetic(staticData.recipes['water-barrel'])).toBe(false);
  });
});
