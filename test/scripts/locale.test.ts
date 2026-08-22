import { describe, expect, it } from 'vitest';
import { resolveLocale } from '../../scripts/locale.ts';
import type { RLocale } from '../../scripts/raw-validators.ts';

const locales: Record<string, RLocale> = {
  recipe: {
    names: { 'wooden-chest': 'Wooden chest', 'iron-plate': 'Iron plate' },
    descriptions: undefined,
  },
  item: {
    names: { 'iron-plate': 'Iron plate', 'copper-plate': 'Copper plate' },
    descriptions: { 'iron-plate': 'A plate made of iron.' },
  },
  fluid: { names: { water: 'Water' }, descriptions: undefined },
};

describe('resolveLocale', () => {
  it('resolves undefined ls via recipe fallback', () => {
    expect(resolveLocale(undefined, 'wooden-chest', locales, 'recipe')).toBe('Wooden chest');
  });

  it('returns undefined when fallback id is not in recipe locale', () => {
    expect(resolveLocale(undefined, 'nonexistent', locales, 'recipe')).toBeUndefined();
  });

  it('returns a plain string literal unchanged', () => {
    expect(resolveLocale('Hard-coded name', 'any', locales, 'recipe')).toBe('Hard-coded name');
  });

  it('resolves a recipe-name key', () => {
    expect(resolveLocale(['recipe-name.wooden-chest'], 'any', locales, 'recipe')).toBe(
      'Wooden chest',
    );
  });

  it('resolves an item-name key', () => {
    expect(resolveLocale(['item-name.iron-plate'], 'any', locales, 'recipe')).toBe('Iron plate');
  });

  it('resolves a fluid-name key', () => {
    expect(resolveLocale(['fluid-name.water'], 'any', locales, 'recipe')).toBe('Water');
  });

  it('concatenates "" elements into a single string', () => {
    expect(
      resolveLocale(['', ['recipe-name.wooden-chest'], ' MK2'], 'any', locales, 'recipe'),
    ).toBe('Wooden chest MK2');
  });

  it('concatenates plain string elements in ""', () => {
    expect(
      resolveLocale(['', 'prefix: ', ['item-name.iron-plate']], 'any', locales, 'recipe'),
    ).toBe('prefix: Iron plate');
  });

  it('returns undefined for "" when an inner element cannot be resolved', () => {
    expect(
      resolveLocale(['', ['recipe-name.nonexistent'], ' MK2'], 'any', locales, 'recipe'),
    ).toBeUndefined();
  });

  it('returns undefined for "?" fallback key', () => {
    expect(
      resolveLocale(['?', ['recipe-name.wooden-chest'], 'fallback'], 'any', locales, 'recipe'),
    ).toBeUndefined();
  });

  it('returns undefined when the key has no dot (e.g. parameter-x)', () => {
    expect(resolveLocale(['parameter-x', '0'], 'any', locales, 'recipe')).toBeUndefined();
  });

  it('returns undefined when the subId is not in the locale', () => {
    expect(resolveLocale(['item-name.nonexistent'], 'any', locales, 'recipe')).toBeUndefined();
  });

  it('returns undefined when the locale file key is not loaded', () => {
    expect(resolveLocale(['entity-name.iron-chest'], 'any', locales, 'recipe')).toBeUndefined();
  });

  it('treats "Something went wrong" sentinel as unresolved', () => {
    const withSentinel: Record<string, RLocale> = {
      item: { names: { 'angels-void': 'Something went wrong' }, descriptions: undefined },
    };
    expect(resolveLocale(['item-name.angels-void'], 'any', withSentinel, 'recipe')).toBeUndefined();
  });

  it('treats all "Unknown X" sentinels as unresolved', () => {
    const withSentinels: Record<string, RLocale> = {
      fluid: {
        names: { foo: 'Unknown fluid', bar: 'Unknown' },
        descriptions: undefined,
      },
    };
    expect(resolveLocale(['fluid-name.foo'], 'any', withSentinels, 'recipe')).toBeUndefined();
    expect(resolveLocale(['fluid-name.bar'], 'any', withSentinels, 'recipe')).toBeUndefined();
  });

  it('uses fallbackLocale param instead of recipe when ls is undefined', () => {
    expect(resolveLocale(undefined, 'water', locales, 'fluid')).toBe('Water');
  });

  it('prefers the dumped resolved name over interpreting ls', () => {
    // the dump has the game's own resolution, which beats anything we reconstruct
    const dump: Record<string, RLocale> = {
      recipe: { names: { 'iron-plate': 'Galena (Lead ore)' }, descriptions: undefined },
      item: { names: { 'iron-plate': 'Iron plate' }, descriptions: undefined },
    };
    expect(resolveLocale(['item-name.iron-plate'], 'iron-plate', dump, 'recipe')).toBe(
      'Galena (Lead ore)',
    );
  });

  it('resolves a parameterised template via the dump', () => {
    // ["item-name.filled-gas-canister", [...]] is "Bottled __1__"; only the game can expand it
    const dump: Record<string, RLocale> = {
      item: {
        names: { 'angels-gas-nitrogen-barrel': 'Bottled Nitrogen gas' },
        descriptions: undefined,
      },
    };
    const ls = ['item-name.filled-gas-canister', ['fluid-name.angels-gas-nitrogen']];
    expect(resolveLocale(ls, 'angels-gas-nitrogen-barrel', dump, 'item')).toBe(
      'Bottled Nitrogen gas',
    );
  });

  it('interprets ls when the dump has no entry for the id', () => {
    expect(resolveLocale(['recipe-name.wooden-chest'], 'not-dumped', locales, 'recipe')).toBe(
      'Wooden chest',
    );
  });

  it('interprets ls when the dumped entry is a sentinel', () => {
    const dump: Record<string, RLocale> = {
      recipe: { names: { thing: 'Unknown recipe' }, descriptions: undefined },
      item: { names: { 'iron-plate': 'Iron plate' }, descriptions: undefined },
    };
    expect(resolveLocale(['item-name.iron-plate'], 'thing', dump, 'recipe')).toBe('Iron plate');
  });

  it('does not return a sentinel from the fallback path', () => {
    const mixed: Record<string, RLocale> = {
      recipe: { names: { chrome: 'Something went wrong' }, descriptions: undefined },
      fluid: { names: { chrome: 'Molten chrome' }, descriptions: undefined },
    };
    expect(resolveLocale(undefined, 'chrome', mixed, 'fluid')).toBe('Molten chrome');
    expect(resolveLocale(undefined, 'chrome', mixed, 'recipe')).toBeUndefined();
  });
});
