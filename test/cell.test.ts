import { describe, expect, it } from 'vitest';
import {
  activeAfterRemoval,
  cellInterface,
  cellTitle,
  entryEffects,
  entryMachine,
  hasRecipe,
  newCell,
  parseCount,
  resetMachines,
  scopeOf,
  slotsUsed,
  withEntry,
  withModule,
  withoutCell,
  withoutEntry,
  withRecipe,
  type Cell,
} from '../src/cell.ts';
import { defaultMachine, machinesFor } from '../src/data/machines.ts';
import { complexityOf, staticData } from '../src/data/index.ts';

/** Ore crushed -> plate -> gear: two recipes which chain, so the middle one goes internal. */
const chain: Cell = { entries: [{ recipe: 'iron-plate' }, { recipe: 'iron-gear-wheel' }] };

describe('cellInterface', () => {
  it('has nothing to say about an empty cell', () => {
    expect(cellInterface(newCell())).toEqual({ inputs: [], outputs: [], inPlay: [] });
  });

  it('reads a lone recipe straight off', () => {
    expect(cellInterface(newCell('iron-plate'))).toEqual({
      inputs: ['item:angels-ore1-crushed'],
      outputs: ['item:iron-plate'],
      inPlay: ['item:angels-ore1-crushed', 'item:iron-plate'],
    });
  });

  /* A void sink consumes a fluid and produces nothing: the marker item its `results` names is
   * dropped by the ingest, so there is no fake output on the cell's right-hand side. */
  it('reads a sink as an input with nothing handed on', () => {
    expect(cellInterface(newCell('angels-water-void-angels-water-yellow-waste'))).toEqual({
      inputs: ['fluid:angels-water-yellow-waste'],
      outputs: [],
      inPlay: ['fluid:angels-water-yellow-waste'],
    });
  });

  it('keeps the open edges while including every resource in play', () => {
    expect(cellInterface(chain)).toEqual({
      inputs: ['item:angels-ore1-crushed'],
      outputs: ['item:iron-gear-wheel'],
      inPlay: ['item:angels-ore1-crushed', 'item:iron-plate', 'item:iron-gear-wheel'],
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

  it('resets every pinned machine to auto while preserving the rest of each entry', () => {
    const cell: Cell = {
      entries: [
        { recipe: 'iron-plate', machine: 'stone-furnace', count: 2 },
        {
          recipe: 'iron-gear-wheel',
          machine: 'assembling-machine-2',
          modules: { 'speed-module': 1 },
        },
        { recipe: 'car' },
      ],
    };

    expect(resetMachines(cell)).toEqual({
      entries: [
        { recipe: 'iron-plate', machine: undefined, count: 2 },
        {
          recipe: 'iron-gear-wheel',
          machine: undefined,
          modules: { 'speed-module': 1 },
        },
        { recipe: 'car' },
      ],
    });
    const auto = { entries: [{ recipe: 'iron-plate' }] };
    expect(resetMachines(auto)).toBe(auto);
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

describe('withModule', () => {
  const entry = { recipe: 'iron-gear-wheel' };

  it('puts modules in and takes them out again', () => {
    const one = withModule(entry, 'speed-module-3', 2);
    expect(one.modules).toEqual({ 'speed-module-3': 2 });
    expect(entry).toEqual({ recipe: 'iron-gear-wheel' });
    // an empty loadout is no loadout, so the hash carries nothing for it
    expect(withModule(one, 'speed-module-3', 0).modules).toBeUndefined();
  });

  it('keeps a module in its place in the queue for the slots', () => {
    const both = withModule(withModule(entry, 'speed-module-3', 1), 'productivity-module-3', 1);
    const more = withModule(both, 'speed-module-3', 2);
    expect(Object.keys(more.modules!)).toEqual(['speed-module-3', 'productivity-module-3']);
    expect(slotsUsed(more.modules)).toBe(3);
  });

  it('counts nothing for no loadout at all', () => {
    expect(slotsUsed(undefined)).toBe(0);
  });
});

describe('entryEffects', () => {
  const recipe = staticData.recipes['iron-gear-wheel'];
  const entry = { recipe: 'iron-gear-wheel', modules: { 'productivity-module-3': 3 } };

  it('is what the modules do in the machine the row is in', () => {
    const effects = entryEffects(entry, recipe, 'assembling-machine-3');
    expect(effects.productivity).toBeCloseTo(1.36);
    expect(effects.speed).toBeCloseTo(0.55);
  });

  it('is worth less in a machine with fewer slots, and nothing in one with none', () => {
    // the same three modules in an assembling machine 2: two slots, so two of them go in
    expect(entryEffects(entry, recipe, 'assembling-machine-2').productivity).toBeCloseTo(1.24);
    // and an assembling machine 1 has no slots at all, as the character has not
    expect(entryEffects(entry, recipe, 'assembling-machine-1')).toEqual({
      speed: 1,
      productivity: 1,
    });
    expect(entryEffects(entry, recipe, 'character')).toEqual({ speed: 1, productivity: 1 });
  });

  it('is 1× for an empty machine, or one the data does not have', () => {
    const bare = { recipe: 'iron-gear-wheel' };
    expect(entryEffects(bare, recipe, 'assembling-machine-3')).toEqual({
      speed: 1,
      productivity: 1,
    });
    expect(entryEffects(entry, recipe, 'no-such-machine')).toEqual({ speed: 1, productivity: 1 });
    expect(entryEffects(entry, recipe, undefined)).toEqual({ speed: 1, productivity: 1 });
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

describe('cell list', () => {
  const three = [newCell('iron-plate'), newCell('iron-gear-wheel'), newCell('car')];

  it('removes a cell without touching the original list', () => {
    expect(withoutCell(three, 1).map((c) => cellTitle(c))).toEqual(['Iron plate', 'Car']);
    expect(three).toHaveLength(3);
  });

  it('keeps working on the same cell when an earlier one goes', () => {
    expect(activeAfterRemoval(2, 0, 2)).toBe(1);
    expect(activeAfterRemoval(1, 2, 2)).toBe(1);
  });

  it('clamps into what is left when the cell being worked on was the last', () => {
    expect(activeAfterRemoval(2, 2, 2)).toBe(1);
    expect(activeAfterRemoval(0, 0, 0)).toBe(0);
  });
});

describe('parseCount', () => {
  it('reads what was typed, and takes anything else as undecided', () => {
    expect(parseCount('2.5')).toBe(2.5);
    expect(parseCount('0')).toBe(0);
    expect(parseCount('')).toBeUndefined();
    expect(parseCount('lots')).toBeUndefined();
  });
});
