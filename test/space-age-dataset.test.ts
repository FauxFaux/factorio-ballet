import { describe, expect, it } from 'vitest';
import { isDeferredRecycling, searchMatches, searchRecipes } from '../src/data/search.ts';
import { spaceAge } from '../src/dataset/catalogue/space-age.ts';
import { moduleEffects } from '../src/data/module-effects.ts';

describe('Space Age dataset', () => {
  it('retains and applies built-in productivity on the three specialized machines', async () => {
    const { staticData } = await spaceAge();
    const productive = ['biochamber', 'foundry', 'electromagnetic-plant'];
    for (const id of productive) {
      expect(staticData.machines[id].baseProductivity).toBe(0.5);
    }
    expect(
      Object.entries(staticData.machines)
        .filter(([, machine]) => machine.baseProductivity !== undefined)
        .map(([id]) => id),
    ).toEqual(productive);

    const plant = staticData.machines['electromagnetic-plant'];
    const circuit = staticData.recipes['electronic-circuit'];
    const module = staticData.recipes['speed-module'];
    expect(circuit.allowProductivity).toBe(true);
    expect(module.allowProductivity).toBeUndefined();
    expect(moduleEffects(staticData, plant, {}, module).productivity).toBe(1.5);
    expect(
      moduleEffects(staticData, plant, { 'productivity-module-3': 1 }, circuit).productivity,
    ).toBeCloseTo(1.6);
    expect(
      moduleEffects(staticData, plant, { 'productivity-module-3': 1 }, module).productivity,
    ).toBe(1.5);
  });

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

  it('puts circuit production ahead of crafted-item recycling at full progress', async () => {
    const { staticData } = await spaceAge();
    const query = 'makes:item:electronic-circuit';
    const recipes = searchRecipes(staticData, query, 1);
    const combined = searchMatches(staticData, query, 1);

    expect(recipes[0]?.id).toBe('electronic-circuit');
    expect(recipes.some(({ recipe }) => isDeferredRecycling(recipe))).toBe(true);
    expect(recipes.map(({ id }) => id)).toEqual(combined.map(({ match }) => match.id));

    const firstRecycling = recipes.findIndex(({ recipe }) => isDeferredRecycling(recipe));
    expect(firstRecycling).toBeGreaterThan(0);
    expect(recipes.slice(firstRecycling).every(({ recipe }) => isDeferredRecycling(recipe))).toBe(
      true,
    );
  });

  it('keeps scrap recycling with ordinary recipes', async () => {
    const { staticData } = await spaceAge();
    const recipes = searchRecipes(staticData, 'makes:item:iron-gear-wheel', 1);
    const scrap = recipes.findIndex(({ id }) => id === 'scrap-recycling');
    const firstRecycling = recipes.findIndex(({ recipe }) => isDeferredRecycling(recipe));

    expect(scrap).toBeGreaterThanOrEqual(0);
    expect(recipes[0]?.recipe.products.map(({ resource }) => resource)).toEqual([
      'item:iron-gear-wheel',
    ]);
    expect(
      recipes.findLastIndex(
        ({ recipe }) => recipe.products.length === 1 && !isDeferredRecycling(recipe),
      ),
    ).toBeLessThan(scrap);
    expect(firstRecycling).toBeGreaterThan(scrap);
  });
});
