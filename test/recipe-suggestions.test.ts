import { describe, expect, it } from 'vitest';
import { newCell } from '../src/cell.ts';
import { suggestedVoidResources } from '../src/components/recipe-suggestions/recipe-suggestions.tsx';

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
