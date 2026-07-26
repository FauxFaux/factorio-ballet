import { describe, expect, it } from 'vitest';
import { staticData } from '../../src/data.ts';
import { processRates, productRate } from '../../src/solver/rates.ts';
import type { ActiveProcess } from '../../src/solver/types.ts';
import type { Recipe } from '../../src/types.ts';

describe('productRate (expected value)', () => {
  it('takes a fixed amount at its probability', () => {
    expect(productRate({ resource: 'item:x', amount: { fixed: 3 }, probability: 1 })).toBe(3);
    expect(
      productRate({ resource: 'item:x', amount: { fixed: 1 }, probability: 0.007 }),
    ).toBeCloseTo(0.007);
  });

  it('uses the midpoint of a ranged amount', () => {
    expect(productRate({ resource: 'item:x', amount: { min: 2, max: 4 }, probability: 1 })).toBe(3);
  });
});

describe('processRates', () => {
  const ap = (recipe: Recipe, extra: Partial<ActiveProcess> = {}): ActiveProcess => ({
    id: 'p',
    recipe,
    ...extra,
  });

  it('divides per-cycle quantities by duration, inputs negative / outputs positive', () => {
    const rates = processRates(
      ap({
        ingredients: [{ resource: 'item:a', amount: 4 }],
        products: [{ resource: 'item:b', amount: { fixed: 1 }, probability: 1 }],
        duration: 2,
      }),
    );
    expect(rates.get('item:a')).toBe(-2);
    expect(rates.get('item:b')).toBe(0.5);
  });

  it('nets a resource that is both consumed and produced', () => {
    const rates = processRates(
      ap({
        ingredients: [{ resource: 'item:x', amount: 2 }],
        products: [{ resource: 'item:x', amount: { fixed: 3 }, probability: 1 }],
        duration: 1,
      }),
    );
    expect(rates.get('item:x')).toBe(1);
  });

  it('applies the outputs multiplier to modifiable products only', () => {
    const recipe: Recipe = {
      ingredients: [],
      products: [
        { resource: 'item:normal', amount: { fixed: 1 }, probability: 1 },
        { resource: 'item:catalyst', amount: { fixed: 1 }, probability: 1 },
      ],
      duration: 1,
    };
    const rates = processRates(
      ap(recipe, { multipliers: { outputs: 1.1 }, unmod: ['item:catalyst'] }),
    );
    expect(rates.get('item:normal')).toBeCloseTo(1.1); // productivity applies
    expect(rates.get('item:catalyst')).toBe(1); // unmodifiable: multiplier skipped
  });

  it('matches a real iron-plate recipe (3 crushed ore → 2 plate / 7s)', () => {
    const rates = processRates(ap(staticData.recipes['iron-plate']));
    expect(rates.get('item:angels-ore1-crushed')).toBeCloseTo(-3 / 7);
    expect(rates.get('item:iron-plate')).toBeCloseTo(2 / 7);
  });
});
