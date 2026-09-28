import { describe, expect, it } from 'vitest';
import { fromAirStages } from '../../src/components/from-air.tsx';
import { fromAirSuggestionStages } from '../../src/compute/from-air.ts';
import { createDataset } from '../../src/dataset/index.ts';
import { spaceAge } from '../../src/dataset/catalogue/space-age.ts';
import type { Recipe, ResourceId } from '../../src/types.ts';
import { defaultDataset } from '../with-bobang.ts';

const recipe = (
  ingredients: ResourceId[],
  products: ResourceId[],
  synthetic = false,
  complexity = 0,
): Recipe => ({
  ingredients: ingredients.map((resource) => ({ resource, amount: 1 })),
  products: products.map((resource) => ({ resource, amount: { fixed: 1 }, probability: 1 })),
  duration: 1,
  categories: ['crafting'],
  synthetic: synthetic || undefined,
  complexity,
});

describe('fromAirStages', () => {
  it('derives the suggestion prefix identically to the full acyclic search', () => {
    expect(fromAirSuggestionStages(defaultDataset.data)).toEqual(
      fromAirStages(defaultDataset.data, false, 1, { maxStages: 2, includeCycles: false }).map(
        (stage) => stage.map(({ id, adds }) => ({ id, adds })),
      ),
    );
  });

  it('unlocks recipes in discrete stages until no new resource can be made', () => {
    const air = 'fluid:air';
    const oxygen = 'fluid:oxygen';
    const plate = 'item:plate';
    const unreachable = 'item:unreachable';
    const stages = fromAirStages({
      recipes: {
        compress: recipe([], [air]),
        separate: recipe([air], [oxygen]),
        smelt: recipe([oxygen], [plate]),
        blocked: recipe([unreachable], ['item:never']),
      },
    });
    expect(stages.map((stage) => stage.map(({ id }) => id))).toEqual([['compress'], ['separate']]);
  });

  it('includes pumping and excludes every synthetic mining recipe', () => {
    const water = 'fluid:water';
    const stages = fromAirStages({
      recipes: {
        'synthetic:pumping-water': recipe([], [water], true),
        'synthetic:mining-ore': recipe([], ['item:ore'], true),
        wash: recipe([water], ['item:washed']),
        useWashed: recipe(['item:washed'], ['item:washed-product']),
      },
    });
    expect(stages.flat().map(({ id }) => id)).toEqual(['synthetic:pumping-water', 'wash']);
  });

  it('optionally unlocks infinite mining after its fluid input, but not finite mining', () => {
    const water = 'fluid:water';
    const stages = fromAirStages(
      {
        recipes: {
          'synthetic:pumping-water': recipe([], [water], true),
          'synthetic:mining-coal': recipe([], ['item:finite-coal'], true),
          'synthetic:mining-infinite-coal': recipe([water], ['item:coal'], true),
          useCoal: recipe(['item:coal'], ['item:coal-product']),
        },
      },
      true,
    );

    expect(stages.map((stage) => stage.map(({ id }) => id))).toEqual([
      ['synthetic:pumping-water'],
      ['synthetic:mining-infinite-coal'],
    ]);
  });

  it('excludes recipes beyond the selected game progress', () => {
    const air = 'fluid:air';
    const early = 'item:early';
    const late = 'item:late';
    const stages = fromAirStages(
      {
        recipes: {
          source: recipe([], [air], false, 0),
          early: recipe([air], [early], false, 0.2),
          late: recipe([air], [late], false, 0.8),
          useEarly: recipe([early], ['item:early-product'], false, 0.2),
          useLate: recipe([late], ['item:late-product'], false, 0.8),
        },
      },
      false,
      0.5,
    );

    expect(stages.flat().map(({ id }) => id)).toEqual(['source', 'early']);
  });

  it('can stop after a bounded number of ordinary stages', () => {
    const air = 'fluid:air';
    const oxygen = 'fluid:oxygen';
    const plate = 'item:plate';
    const stages = fromAirStages(
      {
        recipes: {
          compress: recipe([], [air]),
          separate: recipe([air], [oxygen]),
          smelt: recipe([oxygen], [plate]),
        },
      },
      false,
      1,
      { maxStages: 2, includeCycles: false },
    );

    expect(stages.map((stage) => stage.map(({ id }) => id))).toEqual([['compress'], ['separate']]);
  });

  it('lists all products newly added by a recipe only once', () => {
    const air = 'fluid:air';
    const nitrogen = 'fluid:nitrogen';
    const stages = fromAirStages({
      recipes: {
        separate: recipe([], [air, air, nitrogen]),
        useAir: recipe([air], ['item:air-product']),
        useNitrogen: recipe([nitrogen], ['item:nitrogen-product']),
      },
    });
    expect(stages[0][0].adds).toEqual([air, nitrogen]);
  });

  it('does not display or unlock products with no downstream recipe input', () => {
    const intermediate = 'item:intermediate';
    const stages = fromAirStages({
      recipes: {
        source: recipe([], [intermediate, 'item:unused']),
        consume: recipe([intermediate], ['item:final-product']),
      },
    });

    expect(stages.map((stage) => stage.map(({ id }) => id))).toEqual([['source']]);
    expect(stages[0][0].adds).toEqual([intermediate]);
  });

  it('bootstraps a productive cycle with its circulating resource as an assumed input', () => {
    const seed = 'item:seed';
    const plant = 'item:plant';
    const water = 'fluid:water';
    const stages = fromAirStages({
      recipes: {
        pump: recipe([], [water]),
        grow: {
          ...recipe([seed, water], [plant]),
          ingredients: [
            { resource: seed, amount: 5 },
            { resource: water, amount: 10 },
          ],
          products: [{ resource: plant, amount: { fixed: 45 }, probability: 1 }],
        },
        extract: {
          ...recipe([plant], [seed]),
          ingredients: [{ resource: plant, amount: 5 }],
          products: [{ resource: seed, amount: { fixed: 5.5 }, probability: 1 }],
        },
      },
    });

    const cycle = stages[1][0];
    expect(cycle.recipes).toEqual(['grow', 'extract']);
    expect(cycle.assumedInputs).toEqual([seed]);
    expect(cycle.recipe.ingredients).toEqual([{ resource: water, amount: 10 }]);
    expect(cycle.recipe.products).toEqual([
      { resource: seed, amount: { fixed: 0.5 }, probability: 1 },
      { resource: plant, amount: { fixed: 40 }, probability: 1 },
    ]);
    expect(cycle.adds).toEqual([plant, seed]);
  });

  it('nets every resource before reporting what a productive cycle adds', () => {
    const circuit = 'item:advanced-circuit';
    const seed = 'item:seed';
    const box = 'item:box';
    const stages = fromAirStages({
      recipes: {
        source: recipe([], [circuit]),
        useCircuit: recipe([circuit], ['item:circuit-product']),
        make: {
          ...recipe([circuit, seed], [box]),
          ingredients: [
            { resource: circuit, amount: 5 },
            { resource: seed, amount: 1 },
          ],
        },
        recover: {
          ...recipe([box], [circuit, seed]),
          products: [
            { resource: circuit, amount: { fixed: 1.25 }, probability: 1 },
            { resource: seed, amount: { fixed: 2 }, probability: 1 },
          ],
        },
      },
    });

    const cycle = stages[1].find(({ recipes }) => recipes?.includes('make'));
    expect(cycle?.recipe.ingredients).toEqual([{ resource: circuit, amount: 3.75 }]);
    expect(cycle?.recipe.products).toEqual([
      { resource: seed, amount: { fixed: 1 }, probability: 1 },
    ]);
    expect(cycle?.adds).toEqual([seed]);
  });

  it('does not suggest making and recycling an item at a loss', () => {
    const circuit = 'item:advanced-circuit';
    const box = 'item:box';
    const stages = fromAirStages({
      recipes: {
        source: recipe([], [circuit]),
        make: {
          ...recipe([circuit], [box]),
          ingredients: [{ resource: circuit, amount: 5 }],
        },
        recover: {
          ...recipe([box], [circuit]),
          products: [{ resource: circuit, amount: { fixed: 1.25 }, probability: 1 }],
        },
      },
    });

    expect(stages.flat().filter(({ recipes }) => recipes !== undefined)).toEqual([]);
  });

  it('does not bootstrap a cycle which consumes its circulating resources', () => {
    const a = 'item:a';
    const b = 'item:b';
    expect(fromAirStages({ recipes: { one: recipe([a], [b]), two: recipe([b], [a]) } })).toEqual(
      [],
    );
  });

  it('finds the productive swamp seed cycles in the application data', () => {
    const cycles = fromAirStages(defaultDataset.data)
      .flat()
      .filter(({ recipes }) => recipes !== undefined)
      .map(({ recipes }) => recipes);
    for (const tier of [1, 2, 3]) {
      expect(cycles).toContainEqual([`angels-swamp-${tier}`, `angels-swamp-${tier}-seed`]);
    }
  });

  it('does not report net-consuming recycling outputs as newly available in space age', async () => {
    const dataset = createDataset('space-age', await spaceAge());
    const cycles = fromAirStages(dataset.data)
      .flat()
      .filter(({ recipes }) => recipes !== undefined);
    expect(cycles.map(({ recipes }) => recipes)).toEqual([
      ['pentapod-egg'],
      ['pentapod-egg', 'pentapod-egg-recycling'],
      ['fish-breeding'],
      ['fish-breeding', 'raw-fish-recycling'],
    ]);
    for (const cycle of cycles) {
      const outputs = new Set(cycle.recipe.products.map(({ resource }) => resource));
      expect(cycle.adds.every((resource) => outputs.has(resource))).toBe(true);
    }
  });
});
