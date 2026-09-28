import { describe, expect, it } from 'vitest';
import type { Recipe, ResourceId } from '../../src/types.ts';
import { createDataset } from '../../src/dataset/index.ts';
import { spaceAge } from '../../src/dataset/catalogue/space-age.ts';
import {
  resourceChainFinder,
  singleStepVoidableResources,
  voidPlanFinder,
  voidPlans,
} from '../../src/compute/void-path.ts';
import { defaultDataset } from '../with-bobang.ts';

const recipe = (ingredients: ResourceId[], products: ResourceId[]): Recipe => ({
  ingredients: ingredients.map((resource) => ({ resource, amount: 1 })),
  products: products.map((resource) => ({ resource, amount: { fixed: 1 }, probability: 1 })),
  duration: 1,
  categories: ['crafting'],
});

describe('resourceChainFinder', () => {
  it('excludes the space-age efficiency-module-2 make-and-recycle cycle', async () => {
    const { data } = createDataset('space-age', await spaceAge());
    const recipes = {
      'efficiency-module-2': data.recipes['efficiency-module-2'],
      'efficiency-module-2-recycling': data.recipes['efficiency-module-2-recycling'],
    };

    expect(
      resourceChainFinder({ recipes })('item:processing-unit', ['item:advanced-circuit']),
    ).toEqual([]);
    const allChains = resourceChainFinder(data)(
      'item:processing-unit',
      ['item:advanced-circuit'],
      100,
    );
    expect(allChains.some(({ recipes }) => recipes.includes('efficiency-module-2-recycling'))).toBe(
      false,
    );
  });

  it('rejects a target returned by recycling when the chain consumes more of it', () => {
    const circuit = 'item:advanced-circuit';
    const processor = 'item:processing-unit';
    const box = 'item:box';
    const make = recipe([processor], [box]);
    make.ingredients.push({ resource: circuit, amount: 5 });
    const recover = recipe([box], []);
    recover.products = [
      { resource: circuit, amount: { fixed: 1.25 }, probability: 1 },
      { resource: processor, amount: { fixed: 0.25 }, probability: 1 },
    ];

    const chains = resourceChainFinder({ recipes: { make, recover } })(processor, [circuit]);

    expect(chains).toEqual([]);
  });

  it('scales hand-offs and reports net side inputs', () => {
    const source = 'item:source';
    const circuit = 'item:advanced-circuit';
    const box = 'item:box';
    const target = 'item:target';
    const make = recipe([source], [box]);
    make.ingredients.push({ resource: circuit, amount: 5 });
    make.products = [{ resource: box, amount: { fixed: 2 }, probability: 1 }];
    const recover = recipe([box], []);
    recover.products = [
      { resource: circuit, amount: { fixed: 0.625 }, probability: 1 },
      { resource: target, amount: { fixed: 0.5 }, probability: 1 },
    ];

    expect(resourceChainFinder({ recipes: { make, recover } })(source, [target])).toEqual([
      {
        recipes: ['make', 'recover'],
        target,
        inputs: [circuit],
        outputs: [],
        amounts: { [source]: -1, [circuit]: -3.75, [target]: 1 },
      },
    ]);
  });
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
    const plan = voidPlans('item:angels-slag', defaultDataset.data).find(({ recipes }) =>
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
