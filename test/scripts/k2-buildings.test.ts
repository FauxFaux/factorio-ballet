import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildingList, BUILDING_MILESTONES } from '../../scripts/k2-buildings.ts';
import { sha256 } from '../../scripts/milestones/extract.ts';
import type { MilestoneData } from '../../scripts/milestones/model.ts';
import { decode } from '../../src/bp/decode.ts';
import { decodeStaticData } from '../../src/data/decode-impl.ts';
import type { StaticDataPacked } from '../../src/types.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const data = JSON.parse(read('docs/milestones/k2-data.json')) as MilestoneData;
const staticData = decodeStaticData({
  ...JSON.parse(read('src/assets/dataset/k2/static.json')),
  ...JSON.parse(read('src/assets/dataset/k2/recipes.json')),
} as StaticDataPacked);
const blueprints = BUILDING_MILESTONES.map(({ id, name, blueprint }) => ({
  id,
  name,
  source: `docs/blueprints/${blueprint}.base64`,
  blueprint: decode(read(`docs/blueprints/${blueprint}.base64`)),
}));

describe('K2 building list', () => {
  const result = buildingList(data, staticData.recipes, blueprints);

  it('reproduces the artifact from the five current blueprints and fingerprinted data', () => {
    const { provenance, ...committed } = JSON.parse(read('docs/milestones/k2-buildings.json'));
    expect(committed).toEqual(result);
    expect(provenance.snapshotSha256).toBe(sha256(read('docs/milestones/k2-data.json')));
    expect(provenance.staticSha256).toBe(sha256(read('src/assets/dataset/k2/static.json')));
    expect(provenance.recipesSha256).toBe(sha256(read('src/assets/dataset/k2/recipes.json')));
    for (const { id, source } of blueprints)
      expect(provenance.blueprintHashes[id]).toBe(sha256(read(source)));
    expect(result.milestones.map(({ name, buildingCount }) => [name, buildingCount])).toEqual([
      ['ma1', 16],
      ['ma2', 27],
      ['ma-science', 378],
      ['late game 1', 1651],
      ['late game 2', 6720],
    ]);
    expect(Object.keys(result.buildings)).toHaveLength(30);
    expect(Object.keys(result.recipes)).toHaveLength(56);
  });

  it('expands intermediates per building and includes their crafting time', () => {
    expect(result.buildings['burner-mining-drill']).toMatchObject({
      baseIngredientsPerBuilding: { 'iron-plate': 6, stone: 5 },
      craftsPerBuilding: { 'burner-mining-drill': 1, 'iron-gear-wheel': 3, 'stone-furnace': 1 },
      totalCraftingTimePerBuildingSeconds: 4,
    });
    expect(result.recipes['burner-mining-drill']).toMatchObject({
      outputAmount: 1,
      timeSeconds: 2,
      ingredients: { 'iron-gear-wheel': 3, 'stone-furnace': 1, 'iron-plate': 3 },
    });
  });

  it('preserves multi-item and random yields while growing wood and retaining mined coal', () => {
    expect(result.recipes['copper-cable'].outputAmount).toBe(2);
    expect(result.buildings['small-electric-pole'].baseIngredientsPerBuilding).toEqual({
      'copper-plate': 0.5,
    });
    expect(result.buildings['small-electric-pole'].craftsPerBuilding.wood).toBe(0.025);
    expect(result.recipes.wood).toMatchObject({
      ingredients: {},
      outputAmount: 40,
      timeSeconds: 60,
    });
    expect(result.recipes['kr-sand']).toMatchObject({ outputAmount: 7.5, expectedYield: true });
    expect(result.buildings['steel-furnace'].baseIngredientsPerBuilding.coal).toBeGreaterThan(0);
    expect(result.recipes.coal).toBeUndefined();
    expect(result.recipes['iron-plate']).toBeUndefined();
    for (const recipe of Object.values(result.recipes)) {
      for (const ingredient of Object.keys(recipe.ingredients)) {
        expect(ingredient).not.toContain(':');
        expect(
          result.accounting.baseIngredients.includes(ingredient) ||
            Object.values(result.recipes).some(({ product }) => product === ingredient),
        ).toBe(true);
      }
    }
  });

  it('rejects missing ingredient recipes and cycles instead of truncating the expansion', () => {
    const recipes = { ...staticData.recipes };
    delete recipes['iron-gear-wheel'];
    expect(() => buildingList(data, recipes, blueprints)).toThrow('Missing crafting recipe');
    recipes['iron-gear-wheel'] = {
      ...staticData.recipes['iron-gear-wheel'],
      ingredients: [{ resource: 'item:burner-mining-drill', amount: 1 }],
    };
    expect(() => buildingList(data, recipes, blueprints)).toThrow('Production cycle');
  });

  it('costs one science pack using the five-pack recipe yields and shared intermediates', () => {
    expect(Object.keys(result.sciencePacks)).toEqual([
      'automation-science-pack',
      'chemical-science-pack',
      'logistic-science-pack',
      'military-science-pack',
    ]);
    for (const [id, pack] of Object.entries(result.sciencePacks)) {
      expect(result.recipes[pack.recipe].outputAmount).toBe(5);
      expect(pack.craftsPerPack[id]).toBe(0.2);
      expect(pack.craftsPerPack['kr-blank-tech-card']).toBe(0.2);
    }
    expect(result.sciencePacks['automation-science-pack']).toMatchObject({
      baseIngredientsPerPack: { 'iron-plate': 1, 'copper-plate': 0.8 },
      totalCraftingTimePerPackSeconds: 5,
    });
    expect(result.sciencePacks['logistic-science-pack']).toMatchObject({
      baseIngredientsPerPack: { 'iron-plate': 1.9, 'copper-plate': 1.2 },
      totalCraftingTimePerPackSeconds: 7.25,
    });
  });

  it('expands chemical and military solids while omitting fluid chains and stopping at biomass', () => {
    const chemical = result.sciencePacks['chemical-science-pack'];
    expect(chemical.baseIngredientsPerPack).toMatchObject({
      'iron-plate': 1.4,
      'copper-plate': 3.2,
      coal: 0.25,
    });
    expect(chemical.baseIngredientsPerPack.stone).toBeCloseTo(52 / 15);
    expect(chemical.craftsPerPack['advanced-circuit']).toBe(0.5);
    expect(chemical.craftsPerPack['kr-silicon']).toBeCloseTo(1 / 18);
    expect(result.recipes['chemical-science-pack'].ingredients).toEqual({
      'advanced-circuit': 5,
      'kr-blank-tech-card': 5,
      'kr-glass': 15,
    });
    expect(result.recipes['plastic-bar'].ingredients).toEqual({ coal: 1 });
    const military = result.sciencePacks['military-science-pack'];
    expect(military.baseIngredientsPerPack).toMatchObject({
      'iron-plate': 0.8,
      'copper-plate': 0.2,
      coal: 0.53,
      'kr-biomass': 0.4,
    });
    expect(military.baseIngredientsPerPack.stone).toBeCloseTo(16 / 15);
    expect(military.craftsPerPack['kr-biter-research-data']).toBe(0.04);
    expect(result.recipes['kr-biter-research-data'].timeSeconds).toBe(40);
    expect(result.recipes['kr-biomass']).toBeUndefined();
    expect(result.recipes['sulfuric-acid']).toBeUndefined();
    expect(result.recipes['basic-oil-processing']).toBeUndefined();
  });
});
