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
import { complexityOf, defaultMachine, machinesFor, staticData } from '../src/data.ts';

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

  /* A void sink consumes a fluid and produces nothing: the marker item its `results` names is
   * dropped by the ingest, so there is no fake output on the cell's right-hand side. */
  it('reads a sink as an input with nothing handed on', () => {
    expect(cellInterface(newCell('angels-water-void-angels-water-yellow-waste'))).toEqual({
      inputs: ['fluid:angels-water-yellow-waste'],
      outputs: [],
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

  it('is the machine the entry names, wherever the player is', () => {
    const entry = { recipe: 'iron-gear-wheel', machine: 'character' };
    expect(entryMachine(entry, recipe, 0)).toBe('character');
    expect(entryMachine(entry, recipe, 1)).toBe('character');
  });

  it('stands in the machine suiting the progress when the entry names none', () => {
    expect(entryMachine({ recipe: 'iron-gear-wheel' }, recipe, 0)).toBe('character');
    expect(entryMachine({ recipe: 'iron-gear-wheel' }, recipe, 1)).toBe('bob-assembling-machine-6');
  });
});

describe('defaultMachine', () => {
  const machines = machinesFor(staticData.recipes['iron-gear-wheel']);

  it('walks up the assemblers as the game goes on', () => {
    // hand crafting at the crash site, and this pack's top tier by the end
    expect([0, 0.25, 0.5, 0.62, 0.9].map((p) => defaultMachine(machines, p)?.id)).toEqual([
      'character',
      'assembling-machine-2',
      'assembling-machine-3',
      'bob-assembling-machine-4',
      'bob-assembling-machine-6',
    ]);
  });

  it('never goes backwards', () => {
    const walk = [...Array(21).keys()].map((i) => complexityOf(defaultMachine(machines, i / 20)!));
    expect(walk).toEqual([...walk].sort((a, b) => a - b));
  });

  it('is nearer the progress than any other candidate', () => {
    for (const progress of [0, 0.3, 0.62, 0.9]) {
      const best = defaultMachine(machines, progress);
      const distance = Math.abs(complexityOf(best!) - progress);
      for (const other of machines) {
        expect(
          Math.abs(complexityOf(other) - progress),
          `${other.id} at ${progress}`,
        ).toBeGreaterThanOrEqual(distance);
      }
    }
  });

  it('gives hand crafting the complexity of the crash site', () => {
    expect(machines.find(({ id }) => id === 'character')?.complexity).toBe(0);
  });

  it('has nothing to offer for a recipe no machine can run', () => {
    expect(defaultMachine([], 0.5)).toBeUndefined();
  });
});

describe('cellTitle', () => {
  it('names a cell after its first recipe until the user names it', () => {
    expect(cellTitle(newCell())).toBe('Empty cell');
    expect(cellTitle(chain)).toBe('Iron plate');
    expect(cellTitle({ ...chain, name: 'Gears' })).toBe('Gears');
  });
});
