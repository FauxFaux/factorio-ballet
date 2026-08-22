import { describe, expect, it } from 'vitest';
import { resolveLocale } from '../../scripts/locale.ts';
import type { RLocale } from '../../scripts/raw-validators.ts';

const locales: Record<string, RLocale> = {
  recipe: {
    names: { 'wooden-chest': 'Wooden chest', 'iron-plate': 'Iron plate' },
    descriptions: undefined,
  },
  item: {
    names: {
      'iron-plate': 'Iron plate',
      'copper-plate': 'Copper plate',
      // the game has already expanded ["item-name.filled-gas-canister", ["fluid-name...."]]
      // against bobplates' `filled-gas-canister=Bottled __1__`
      'angels-gas-nitrogen-barrel': 'Bottled Nitrogen gas',
    },
    descriptions: { 'iron-plate': 'A plate made of iron.' },
  },
  fluid: { names: { water: 'Water' }, descriptions: undefined },
};

describe('resolveLocale', () => {
  it('resolves a name from the matching locale', () => {
    expect(resolveLocale('wooden-chest', locales, 'recipe')).toBe('Wooden chest');
  });

  it('resolves a parameterised template the game already expanded', () => {
    expect(resolveLocale('angels-gas-nitrogen-barrel', locales, 'item')).toBe(
      'Bottled Nitrogen gas',
    );
  });

  it('takes the name from the requested type, not another that shares the id', () => {
    const mixed: Record<string, RLocale> = {
      recipe: { names: { chrome: 'Chrome smelting' }, descriptions: undefined },
      fluid: { names: { chrome: 'Molten chrome' }, descriptions: undefined },
    };
    expect(resolveLocale('chrome', mixed, 'fluid')).toBe('Molten chrome');
    expect(resolveLocale('chrome', mixed, 'recipe')).toBe('Chrome smelting');
  });

  it('returns undefined when the id is not in the locale', () => {
    expect(resolveLocale('nonexistent', locales, 'recipe')).toBeUndefined();
  });

  it('returns undefined when the locale file was not loaded', () => {
    expect(resolveLocale('iron-chest', locales, 'entity')).toBeUndefined();
  });

  it('treats "Something went wrong" as unresolved', () => {
    const withSentinel: Record<string, RLocale> = {
      item: { names: { 'angels-void': 'Something went wrong' }, descriptions: undefined },
    };
    expect(resolveLocale('angels-void', withSentinel, 'item')).toBeUndefined();
  });

  it('treats every "Unknown X" sentinel as unresolved', () => {
    const withSentinels: Record<string, RLocale> = {
      fluid: {
        names: { foo: 'Unknown fluid', bar: 'Unknown', baz: 'Unknown recipe' },
        descriptions: undefined,
      },
    };
    for (const id of ['foo', 'bar', 'baz']) {
      expect(resolveLocale(id, withSentinels, 'fluid')).toBeUndefined();
    }
  });
});
