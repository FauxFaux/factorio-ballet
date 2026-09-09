import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Cell } from '../src/cell.ts';
import { staticData } from '../src/data/decode.ts';
import { fingerprint, packCells, unpackCells } from '../src/pack.ts';

const recipe = Object.keys(staticData.recipes)[0];
const machine = Object.keys(staticData.machines)[0];
const [moduleA, moduleB] = Object.keys(staticData.modules);

describe('packCells', () => {
  it('round-trips a cell', () => {
    const cells: Cell[] = [
      {
        name: 'silicon',
        entries: [
          { recipe: 'copper-cable', count: 2.5 },
          {
            recipe: 'iron-gear-wheel',
            machine,
            productivityModules: 2,
            speedModules: 4,
            beacons: 3,
          },
          { recipe, modules: { [moduleA]: 1, [moduleB]: 2 } },
        ],
      },
      {
        entries: [],
        design: {
          columns: [
            {
              entities: [
                {
                  kind: 'assembler',
                  position: { x: 2, y: 3 },
                  size: { width: 3, height: 3 },
                  recipe: 'copper-cable',
                },
                { kind: 'belt', position: { x: 1, y: 3 }, direction: 'east' },
                {
                  kind: 'underground-belt',
                  position: { x: 4, y: 3 },
                  direction: 'east',
                  end: 'output',
                },
                { kind: 'splitter', position: { x: 5, y: 3 }, direction: 'south' },
                { kind: 'pipe', position: { x: 2, y: 2 } },
                { kind: 'underground-pipe', position: { x: 2, y: 1 }, direction: 'south' },
                { kind: 'inserter', position: { x: 1, y: 2 }, direction: 'east' },
              ],
            },
          ],
        },
      },
    ];
    expect(unpackCells(packCells(cells))).toEqual(cells);
  });

  it('numbers the ids it knows', () => {
    const packed = packCells([{ entries: [{ recipe: 'copper-cable', machine }] }]);
    expect(packed[0].entries[0]).toEqual({
      recipe: Object.keys(staticData.recipes).indexOf('copper-cable'),
      machine: 0,
    });
  });

  it('keeps an id the dataset does not have', () => {
    // What a hash written against an older `static.json` leaves behind: the app draws the row as
    // missing, and re-packing it must not lose which recipe it was.
    const cells: Cell[] = [{ entries: [{ recipe: 'gone-recipe', machine: 'gone-machine' }] }];
    expect(packCells(cells)[0].entries[0]).toEqual({
      recipe: 'gone-recipe',
      machine: 'gone-machine',
    });
    expect(unpackCells(packCells(cells))).toEqual(cells);
  });

  it('turns an index it cannot reach into a name nothing matches', () => {
    const [entry] = unpackCells([{ entries: [{ recipe: 999999 }] }])[0].entries;
    expect(entry.recipe).toBe('#999999');
    expect(staticData.recipes[entry.recipe]).toBeUndefined();
  });

  it('keeps a loadout in the order it fills the slots', () => {
    // The reason `modules` packs as pairs: as object keys, integer-like ids would come back sorted.
    const modules = { [moduleB]: 1, [moduleA]: 3 };
    const packed = packCells([{ entries: [{ recipe, modules }] }]);
    expect(packed[0].entries[0].modules).toEqual([
      [1, 1],
      [0, 3],
    ]);
    expect(Object.keys(unpackCells(packed)[0].entries[0].modules!)).toEqual([moduleB, moduleA]);
  });

  it('drops an empty loadout rather than packing it', () => {
    const packed = packCells([{ entries: [{ recipe, modules: {} }] }]);
    expect(packed[0].entries[0]).toEqual({ recipe: 0 });
  });

  it('packs contiguous belts as direction paths', () => {
    const cells: Cell[] = [
      {
        entries: [],
        design: {
          columns: [
            {
              entities: [
                { kind: 'belt', position: { x: 2, y: 3 }, direction: 'east' },
                { kind: 'belt', position: { x: 3, y: 3 }, direction: 'north' },
                { kind: 'belt', position: { x: 3, y: 2 }, direction: 'west' },
                { kind: 'belt', position: { x: 9, y: 9 }, direction: 'south' },
              ],
            },
          ],
        },
      },
    ];

    expect(packCells(cells)[0].design?.columns[0].entities).toEqual([
      [1, 2, 3, 'enw'],
      [1, 9, 9, 's'],
    ]);
    expect(unpackCells(packCells(cells))).toEqual(cells);
  });

  it('substantially shrinks a belt-heavy design', () => {
    const state = JSON.parse(
      readFileSync(new URL('assets/belts.state.json', import.meta.url), 'utf8'),
    ) as { cl: Cell[] };
    const originalLength = JSON.stringify(state.cl).length;
    const packed = packCells(state.cl);

    expect(unpackCells(packed)).toEqual(state.cl);
    expect(JSON.stringify(packed).length).toBeLessThan(originalLength / 2);
  });
});

describe('fingerprint', () => {
  it('is three characters of the ids it numbers', () => {
    expect(fingerprint).toMatch(/^[0-9a-z]{3}$/);
  });
});
