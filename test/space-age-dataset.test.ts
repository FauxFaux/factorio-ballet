import { describe, expect, it } from 'vitest';
import { spaceAge } from '../src/dataset/catalogue/space-age.ts';

describe('Space Age dataset', () => {
  it('loads the 2.1 recipes and one icon sheet', async () => {
    const { staticData, iconMap } = await spaceAge();
    const scrap = staticData.recipes['scrap-recycling'];
    const uranium = staticData.recipes['uranium-processing'];
    const recycled = staticData.recipes['speed-module-recycling'];

    expect(scrap.categories).toEqual(['recycling', 'hand-crafting']);
    expect(scrap.products.find((p) => p.resource === 'item:solid-fuel')?.probability).toBeCloseTo(
      0.07,
    );
    expect(
      uranium.products.find((p) => p.resource === 'item:uranium-235')?.probability,
    ).toBeCloseTo(0.007);
    expect(recycled.categories).toEqual(['recycling']);
    expect(recycled.products.find((p) => p.resource === 'item:advanced-circuit')?.amount).toEqual({
      fixed: 1.25,
    });
    expect(staticData.recipes['casting-iron'].categories).toEqual(['metallurgy']);
    expect(new Set(Object.values(iconMap).map(([url]) => url)).size).toBe(1);
    expect(iconMap['item:item-unknown']).toBeDefined();
    expect(iconMap['item:item-unknown']?.slice(3)).toEqual([896, 864]);
  });
});
