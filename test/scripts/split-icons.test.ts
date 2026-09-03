import { describe, expect, it } from 'vitest';
import { splitIcons, type IconData } from '../../scripts/split-icons.ts';

const data = {
  recipes: {
    early: { complexity: 0.1 },
    middle: { complexity: 0.5 },
    late: { complexity: 0.9 },
  },
  resources: {
    'item:belt': { complexity: 0.2 },
    'item:early': { complexity: 0.1 },
    'item:middle': { complexity: 0.5 },
    'item:late': { complexity: 0.9 },
  },
  machines: {},
  modules: {},
  beacons: {},
  belts: { belt: {} },
} satisfies IconData;

describe('splitIcons', () => {
  it('keeps aliases together and gives UI cells precedence', () => {
    const result = splitIcons(
      {
        'recipe:early': [0, 0],
        'craft:early': [0, 0],
        'recipe:belt': [32, 0],
        'craft:belt': [32, 0],
        'recipe:middle': [64, 0],
        'recipe:late': [96, 0],
        'craft:unknown': [128, 0],
      },
      data,
    );

    expect(result[0]?.cells.flatMap((cell) => cell.keys)).toEqual(['recipe:belt', 'craft:belt']);
    expect(
      result
        .slice(1)
        .flatMap((split) => split.cells)
        .flatMap((cell) => cell.keys),
    ).toEqual(['recipe:early', 'craft:early', 'recipe:middle', 'recipe:late', 'craft:unknown']);
  });

  it('makes four balanced, ascending complexity ranges', () => {
    const icons = Object.fromEntries(
      Array.from({ length: 10 }, (_, index): [string, [number, number]] => [
        `recipe:r${index}`,
        [index * 32, 0],
      ]),
    );
    const recipes = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`r${index}`, { complexity: (9 - index) / 10 }]),
    );
    const result = splitIcons(icons, { ...data, recipes }).slice(1);

    expect(result.map((split) => split.cells.length)).toEqual([2, 3, 2, 3]);
    const ranges = result.map((split) => split.cells.map((cell) => cell.complexity));
    expect(ranges.map((range) => [Math.min(...range), Math.max(...range)])).toEqual([
      [0, 0.1],
      [0.2, 0.4],
      [0.5, 0.6],
      [0.7, 0.9],
    ]);
  });
});
