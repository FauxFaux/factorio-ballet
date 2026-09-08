import { describe, expect, it } from 'vitest';
import { newCell } from '../src/cell.ts';
import {
  suggestedResourceChains,
  suggestedVoidResources,
} from '../src/components/recipe-suggestions/recipe-suggestions.tsx';

const waste = 'fluid:angels-water-yellow-waste' as const;

describe('suggestedVoidResources', () => {
  it('includes the resource targeted by a uses search', () => {
    expect(suggestedVoidResources(`uses:${waste}`)).toEqual([waste]);
  });

  it('includes cell outputs, including those named by uses:@out only once', () => {
    const cell = newCell('empty-angels-water-yellow-waste-barrel');
    const suggestions = suggestedVoidResources('uses:@out', cell);

    expect(suggestions).toContain(waste);
    expect(suggestions.filter((resource) => resource === waste)).toHaveLength(1);
  });
});

describe('suggestedResourceChains', () => {
  it('turns a cell output into one of its current inputs', () => {
    const cell = {
      entries: [{ recipe: 'angels-ore1-chunk' }, { recipe: 'angels-ore1-crystal' }],
    };

    const chains = suggestedResourceChains(cell).get(waste) ?? [];

    expect(chains).toContainEqual({
      target: 'fluid:angels-liquid-sulfuric-acid',
      recipes: [
        'angels-yellow-waste-water-purification',
        'angels-gas-sulfur-dioxide',
        'angels-liquid-sulfuric-acid',
      ],
      inputs: ['fluid:angels-gas-oxygen'],
      outputs: ['fluid:angels-water-mineralized'],
    });
  });
});
