import { describe, expect, it } from 'vitest';
import {
  flipDirection,
  parseSearch,
  resolveResources,
  searchRecipes,
  type SearchScope,
} from '../src/search.ts';
import { packLandmarks, relevanceOf } from '../src/data.ts';

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

  it('reads an @-query off the cell being worked on', () => {
    expect(resolveResources('@in', scope)).toEqual(scope.in);
    expect(resolveResources('@out', scope)).toEqual(scope.out);
    expect(resolveResources('@edge', scope)).toEqual(
      new Set(['item:angels-ore1-crushed', 'item:iron-gear-wheel']),
    );
  });

  it('finds nothing for an @-query with no cell, or no such query', () => {
    expect(resolveResources('@in')).toEqual(new Set());
    expect(resolveResources('@nonsense', scope)).toEqual(new Set());
  });
});

/** As a cell of `iron-plate` + `iron-gear-wheel`; see `cell.test.ts`. */
const scope: SearchScope = {
  in: new Set(['item:angels-ore1-crushed']),
  out: new Set(['item:iron-gear-wheel']),
};

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
  it('answers an @-query about the cell it was given', () => {
    const found = searchRecipes('makes:@in', 0, scope);
    expect(found.length).toBeGreaterThan(0);
    for (const { recipe } of found) {
      expect(recipe.products.some((p) => p.resource === 'item:angels-ore1-crushed')).toBe(true);
    }
    // ...and the same query outside a cell is not a free-for-all
    expect(searchRecipes('makes:@in', 0)).toEqual([]);
  });

  it('finds nothing without a search', () => {
    expect(searchRecipes('   ', 0)).toEqual([]);
  });

  it('finds the recipes producing a resource', () => {
    const found = searchRecipes('makes:item:iron-plate', 0);
    expect(found.length).toBeGreaterThan(0);
    for (const { recipe } of found) {
      expect(recipe.products.some((p) => p.resource === 'item:iron-plate')).toBe(true);
    }
  });

  it('finds the recipes consuming a resource', () => {
    const found = searchRecipes('uses:item:iron-plate', 0);
    expect(found.length).toBeGreaterThan(0);
    for (const { recipe } of found) {
      expect(recipe.ingredients.some((i) => i.resource === 'item:iron-plate')).toBe(true);
    }
  });

  it('matches recipes by name and by id', () => {
    expect(searchRecipes('iron-plate', 0).map((m) => m.id)).toContain('iron-plate');
    expect(searchRecipes('Iron plate', 0).map((m) => m.id)).toContain('iron-plate');
  });

  it('requires every term to match', () => {
    const both = searchRecipes('makes:item:iron-plate uses:item:iron-plate', 0);
    for (const { recipe } of both) {
      expect(recipe.products.some((p) => p.resource === 'item:iron-plate')).toBe(true);
      expect(recipe.ingredients.some((i) => i.resource === 'item:iron-plate')).toBe(true);
    }
    expect(both.length).toBeLessThan(searchRecipes('makes:item:iron-plate', 0).length);
  });

  it('puts what you can nearly build first, not what is simplest', () => {
    const at = (progress: number) => searchRecipes('uses:item:iron-plate', progress);
    // at the crash site the whole point is the cheap end
    expect(at(0)[0].recipe.complexity).toBe(0);

    // ...but four fifths of the way in, nothing at the cheap end is what you are building
    const late = at(0.8);
    expect(late[0].recipe.complexity).toBeGreaterThan(0.5);
    // and it is the *nearest* thing, above or below, rather than the most advanced one
    const spread = late.map((m) => relevanceOf(m.recipe, 0.8));
    expect(spread).toEqual([...spread].sort((a, b) => a - b));
  });
});

describe('packLandmarks', () => {
  it('keeps the packs people name their progress after', () => {
    expect(packLandmarks.map((p) => p.id)).toEqual([
      'item:automation-science-pack',
      'item:logistic-science-pack',
      'item:military-science-pack',
      'item:chemical-science-pack',
      'item:production-science-pack',
      'item:utility-science-pack',
      'item:space-science-pack',
    ]);
  });

  it('thins the packs which would land on top of each other', () => {
    // bob's ships ten between production and utility science; none of them survive
    for (const [i, pack] of packLandmarks.entries()) {
      if (i === 0) continue;
      expect(pack.complexity - packLandmarks[i - 1].complexity).toBeGreaterThanOrEqual(0.04);
    }
  });
});

describe('relevanceOf', () => {
  it('measures distance in either direction', () => {
    expect(relevanceOf({ complexity: 0.3 }, 0.5)).toBeCloseTo(0.2);
    expect(relevanceOf({ complexity: 0.7 }, 0.5)).toBeCloseTo(0.2);
  });

  it('is plain complexity at the crash site', () => {
    expect(relevanceOf({ complexity: 0.3 }, 0)).toBeCloseTo(0.3);
  });

  it('sorts something unreachable last', () => {
    expect(relevanceOf({}, 0.5)).toBe(Infinity);
  });
});
