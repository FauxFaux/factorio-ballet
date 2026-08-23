import { describe, expect, it } from 'vitest';
import { flipDirection, parseSearch, resolveResources, searchRecipes } from '../src/search.ts';

describe('resolveResources', () => {
  it('takes an exact resource id alone', () => {
    expect([...resolveResources('item:iron-plate')]).toEqual(['item:iron-plate']);
  });

  it('takes an exact internal name over the substring matches', () => {
    expect([...resolveResources('water')]).toEqual(['fluid:water']);
  });

  it('takes an exact human name', () => {
    expect([...resolveResources('Iron plate')]).toEqual(['item:iron-plate']);
  });

  it('falls back to substring matches', () => {
    const found = resolveResources('plate');
    expect(found.has('item:iron-plate')).toBe(true);
    expect(found.size).toBeGreaterThan(1);
  });

  it('finds nothing for nothing', () => {
    expect(resolveResources('')).toEqual(new Set());
    expect(resolveResources('definitely-not-a-resource')).toEqual(new Set());
  });
});

describe('flipDirection', () => {
  it('flips a lone makes:/uses: term', () => {
    expect(flipDirection('uses:item:foo')).toEqual('makes:item:foo');
    expect(flipDirection(' makes:item:foo ')).toEqual('uses:item:foo');
  });

  it('has nothing to flip without exactly one directed term', () => {
    expect(flipDirection('')).toBeNull();
    expect(flipDirection('item:foo')).toBeNull();
    expect(flipDirection('makes:')).toBeNull();
    expect(flipDirection('makes:water circuit')).toBeNull();
  });
});

describe('parseSearch', () => {
  it('recognises makes: and uses: prefixes', () => {
    expect(parseSearch('makes:item:iron-plate uses:water')).toEqual([
      { kind: 'makes', query: 'item:iron-plate', resources: new Set(['item:iron-plate']) },
      { kind: 'uses', query: 'water', resources: new Set(['fluid:water']) },
    ]);
  });

  it('treats anything else as text', () => {
    expect(parseSearch('  iron  Plate ')).toEqual([
      { kind: 'text', text: 'iron' },
      { kind: 'text', text: 'plate' },
    ]);
  });
});

describe('searchRecipes', () => {
  it('finds nothing without a search', () => {
    expect(searchRecipes('   ')).toEqual([]);
  });

  it('finds the recipes producing a resource', () => {
    const found = searchRecipes('makes:item:iron-plate');
    expect(found.length).toBeGreaterThan(0);
    for (const { recipe } of found) {
      expect(recipe.products.some((p) => p.resource === 'item:iron-plate')).toBe(true);
    }
  });

  it('finds the recipes consuming a resource', () => {
    const found = searchRecipes('uses:item:iron-plate');
    expect(found.length).toBeGreaterThan(0);
    for (const { recipe } of found) {
      expect(recipe.ingredients.some((i) => i.resource === 'item:iron-plate')).toBe(true);
    }
  });

  it('matches recipes by name and by id', () => {
    expect(searchRecipes('iron-plate').map((m) => m.id)).toContain('iron-plate');
    expect(searchRecipes('Iron plate').map((m) => m.id)).toContain('iron-plate');
  });

  it('requires every term to match', () => {
    const both = searchRecipes('makes:item:iron-plate uses:item:iron-plate');
    for (const { recipe } of both) {
      expect(recipe.products.some((p) => p.resource === 'item:iron-plate')).toBe(true);
      expect(recipe.ingredients.some((i) => i.resource === 'item:iron-plate')).toBe(true);
    }
    expect(both.length).toBeLessThan(searchRecipes('makes:item:iron-plate').length);
  });
});
