import { describe, expect, it } from 'vitest';
import { machinesFor, staticData } from '../src/data.ts';
import { searchRecipes } from '../src/search.ts';

/**
 * Against the shipped `static.json`, so these are as much a check on the ingest as on the app: the
 * rates are the ones the game actually runs at, and getting them wrong is silent.
 */
describe('synthetic recipes', () => {
  it('pumps water out of nothing, at 1200/s in a vanilla offshore pump', () => {
    const recipe = staticData.recipes['synthetic:pumping-water'];
    expect(recipe.synthetic).toBe(true);
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.products).toEqual([
      { resource: 'fluid:water', amount: { fixed: 60 }, probability: 1 },
    ]);

    const pump = machinesFor(recipe).find(({ id }) => id === 'offshore-pump');
    expect(pump?.machine.kind).toBe('offshore-pump');
    // amount × speed / duration, as any other recipe: 60 × 20 / 1
    expect((60 * pump!.machine.speed) / recipe.duration).toBe(1200);
  });

  it('mines an ore patch, at 0.5/s in an electric mining drill', () => {
    const recipe = staticData.recipes['synthetic:mining-coal'];
    expect(recipe.synthetic).toBe(true);
    expect(recipe.products.map((p) => p.resource)).toEqual(['item:coal']);

    const drill = machinesFor(recipe).find(({ id }) => id === 'electric-mining-drill');
    expect(drill?.machine.kind).toBe('mining-drill');
    expect(drill!.machine.speed / recipe.duration).toBe(0.5);
  });

  it('charges the infinite ores their acid, a tenth of the prototype figure', () => {
    const recipe = staticData.recipes['synthetic:mining-infinite-angels-ore1'];
    expect(recipe.ingredients).toEqual([
      { resource: 'fluid:angels-liquid-sulfuric-acid', amount: 1 },
    ]);
  });

  it('keeps a drill to the resource categories it can actually work', () => {
    const solid = machinesFor(staticData.recipes['synthetic:mining-coal']).map((m) => m.id);
    const fluid = machinesFor(staticData.recipes['synthetic:mining-crude-oil']).map((m) => m.id);
    expect(solid).toContain('electric-mining-drill');
    expect(solid).not.toContain('pumpjack');
    expect(fluid).toContain('pumpjack');
    expect(fluid).not.toContain('electric-mining-drill');
  });

  it('turns up in a search for what it makes', () => {
    expect(searchRecipes('makes:fluid:water', 0).map((m) => m.id)).toContain(
      'synthetic:pumping-water',
    );
  });

  it('gives every synthetic recipe a machine, a product and a name', () => {
    const all = Object.entries(staticData.recipes).filter(([, r]) => r.synthetic);
    expect(all.length).toBeGreaterThan(0);
    for (const [id, recipe] of all) {
      expect(id, `${id} is namespaced`).toMatch(/^synthetic:/);
      expect(recipe.products.length, `${id} makes something`).toBeGreaterThan(0);
      expect(recipe.duration, `${id} takes time`).toBeGreaterThan(0);
      expect(recipe.human, `${id} is named`).toBeTruthy();
      expect(machinesFor(recipe).length, `${id} has a machine`).toBeGreaterThan(0);
    }
  });
});
