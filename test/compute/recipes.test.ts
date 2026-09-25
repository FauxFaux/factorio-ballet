import { describe, expect, it } from 'vitest';
import { isBarrelling, isSynthetic, isUnbarrelling, isVoid } from '../../src/compute/recipes.ts';
import { defaultDataset } from '../../src/dataset';

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
    expect(isVoid(defaultDataset.data.recipes['water-barrel'])).toBe(false);
  });

  it('detects both directions of barrelling', () => {
    expect(isBarrelling(defaultDataset.data.recipes['water-barrel'])).toBe(true);
    expect(isUnbarrelling(defaultDataset.data.recipes['water-barrel'])).toBe(false);
    expect(isUnbarrelling(defaultDataset.data.recipes['empty-water-barrel'])).toBe(true);
    expect(isBarrelling(defaultDataset.data.recipes['empty-water-barrel'])).toBe(false);
    expect(isBarrelling(defaultDataset.data.recipes['angels-gas-nitrogen-barrel'])).toBe(true);
    expect(isUnbarrelling(defaultDataset.data.recipes['empty-angels-gas-nitrogen-barrel'])).toBe(
      true,
    );
  });

  it('detects synthetic recipes from their explicit marker', () => {
    expect(isSynthetic(defaultDataset.data.recipes['synthetic:pumping-water'])).toBe(true);
    expect(isSynthetic(defaultDataset.data.recipes['water-barrel'])).toBe(false);
  });
});
