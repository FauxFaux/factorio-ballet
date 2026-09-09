import { describe, expect, it } from 'vitest';
import { staticData } from '../src/data/decode.ts';
import type { Recipe, ResourceId } from '../src/types.ts';
import { singleStepVoidableResources, voidPlanFinder, voidPlans } from '../src/void-path.ts';

const recipe = (ingredients: ResourceId[], products: ResourceId[]): Recipe => ({
  ingredients: ingredients.map((resource) => ({ resource, amount: 1 })),
  products: products.map((resource) => ({ resource, amount: { fixed: 1 }, probability: 1 })),
  duration: 1,
  categories: ['crafting'],
});

describe('voidPlans', () => {
  it('indexes resources which can be voided without supplying another input', () => {
    const waste = 'item:waste';
    const assistedWaste = 'item:assisted-waste';
    const reagent = 'item:reagent';
    const voidable = singleStepVoidableResources({
      recipes: {
        direct: recipe([waste], []),
        assisted: recipe([assistedWaste, reagent], []),
      },
    });

    expect(voidable.has(waste)).toBe(true);
    expect(voidable.has(assistedWaste)).toBe(false);
    expect(voidable.has(reagent)).toBe(false);
  });

  it('indexes and memoises paths for immutable recipe data', () => {
    const waste = 'item:waste';
    const finder = voidPlanFinder({ recipes: { void: recipe([waste], []) } });

    expect(finder(waste)).toBe(finder(waste));
  });

  it('prefers a closed route without unresolved coproducts', () => {
    const waste = 'item:waste';
    const intermediate = 'item:intermediate';
    const unwanted = 'item:unwanted';
    const water = 'fluid:water';
    const plans = voidPlans(waste, {
      recipes: {
        dirty: recipe([waste], [intermediate, unwanted]),
        clean: recipe([waste, water], [intermediate]),
        pump: recipe([], [water]),
        void: recipe([intermediate], []),
      },
    });

    expect(plans[0]?.recipes).toEqual(['pump', 'clean', 'void']);
    expect(plans.some((plan) => plan.recipes.includes('dirty'))).toBe(false);
  });

  it('finds the expected crushed-slag route', () => {
    const plan = voidPlans('item:angels-slag', staticData).find(({ recipes }) =>
      [
        'angels-stone-crushed',
        'angels-water-mineralized',
        'synthetic:pumping-water',
        'angels-water-void-angels-water-mineralized',
      ].every((id) => recipes.includes(id)),
    );
    expect(plan).toBeDefined();
  });
});
