import { describe, expect, it } from 'vitest';
import {
  cellInterface,
  cellTitle,
  entryMachine,
  hasRecipe,
  newCell,
  scopeOf,
  withEntry,
  withoutEntry,
  withRecipe,
  type Cell,
} from '../src/cell.ts';
import { machinesFor } from '../src/data.ts';
import { staticData } from '../src/data.ts';

/** Ore crushed -> plate -> gear: two recipes which chain, so the middle one goes internal. */
const chain: Cell = { entries: [{ recipe: 'iron-plate' }, { recipe: 'iron-gear-wheel' }] };

describe('cellInterface', () => {
  it('has nothing to say about an empty cell', () => {
    expect(cellInterface(newCell())).toEqual({ inputs: [], outputs: [], internal: [] });
  });

  it('reads a lone recipe straight off', () => {
    expect(cellInterface(newCell('iron-plate'))).toEqual({
      inputs: ['item:angels-ore1-crushed'],
      outputs: ['item:iron-plate'],
      internal: [],
    });
  });

  it('takes what one recipe hands the next out of the interface', () => {
    expect(cellInterface(chain)).toEqual({
      inputs: ['item:angels-ore1-crushed'],
      outputs: ['item:iron-gear-wheel'],
      internal: ['item:iron-plate'],
    });
  });

  it('ignores an entry the data no longer has', () => {
    const stale = { entries: [{ recipe: 'no-such-recipe' }, { recipe: 'iron-gear-wheel' }] };
    expect(cellInterface(stale)).toEqual(cellInterface(newCell('iron-gear-wheel')));
  });

  it('sorts each side simplest first', () => {
    const { inputs } = cellInterface({
      entries: [{ recipe: 'iron-gear-wheel' }, { recipe: 'car' }],
    });
    const complexity = inputs.map((id) => staticData.resources[id].complexity ?? Infinity);
    expect(inputs.length).toBeGreaterThan(1);
    expect(complexity).toEqual([...complexity].sort((a, b) => a - b));
  });
});

describe('scopeOf', () => {
  it('is the two open edges, as the search reads them', () => {
    expect(scopeOf(cellInterface(chain))).toEqual({
      in: new Set(['item:angels-ore1-crushed']),
      out: new Set(['item:iron-gear-wheel']),
    });
  });
});

describe('entries', () => {
  it('runs each recipe once', () => {
    const once = withRecipe(newCell('iron-plate'), 'iron-plate');
    expect(once.entries).toHaveLength(1);
    expect(hasRecipe(once, 'iron-plate')).toBe(true);
    expect(hasRecipe(once, 'iron-gear-wheel')).toBe(false);
  });

  it('adds, replaces and removes without touching the original', () => {
    const added = withRecipe(chain, 'car');
    expect(added.entries.map((e) => e.recipe)).toEqual(['iron-plate', 'iron-gear-wheel', 'car']);
    expect(withEntry(chain, 1, { recipe: 'iron-gear-wheel', count: 2.5 }).entries[1]).toEqual({
      recipe: 'iron-gear-wheel',
      count: 2.5,
    });
    expect(withoutEntry(chain, 0).entries.map((e) => e.recipe)).toEqual(['iron-gear-wheel']);
    expect(chain.entries.map((e) => e.recipe)).toEqual(['iron-plate', 'iron-gear-wheel']);
  });
});

describe('entryMachine', () => {
  const recipe = staticData.recipes['iron-gear-wheel'];

  it('is the machine the entry names', () => {
    expect(entryMachine({ recipe: 'iron-gear-wheel', machine: 'character' }, recipe)).toBe(
      'character',
    );
  });

  it('stands in the first machine which could run it when the entry names none', () => {
    expect(entryMachine({ recipe: 'iron-gear-wheel' }, recipe)).toBe(machinesFor(recipe)[0].id);
  });
});

describe('cellTitle', () => {
  it('names a cell after its first recipe until the user names it', () => {
    expect(cellTitle(newCell())).toBe('Empty cell');
    expect(cellTitle(chain)).toBe('Iron plate');
    expect(cellTitle({ ...chain, name: 'Gears' })).toBe('Gears');
  });
});
