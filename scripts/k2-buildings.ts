#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { decode } from '../src/bp/decode.ts';
import type { Blueprint } from '../src/bp/decode.ts';
import { decodeStaticData } from '../src/data/decode-impl.ts';
import type { StaticData, StaticDataPacked } from '../src/types.ts';
import { sha256 } from './milestones/extract.ts';
import { bill, blueprintMilestone, sorted } from './milestones/model.ts';
import type { Amounts, MilestoneData, MilestoneRecipe } from './milestones/model.ts';

const OUTPUT = 'docs/milestones/k2-buildings.json';
const BASE_INGREDIENTS = ['iron-plate', 'copper-plate', 'stone', 'kr-biomass', 'coal'];
const SCIENCE_PACKS = [
  'automation-science-pack',
  'chemical-science-pack',
  'logistic-science-pack',
  'military-science-pack',
];
export const BUILDING_MILESTONES = [
  { id: 'ma1', name: 'ma1', blueprint: 'ma1' },
  { id: 'ma2', name: 'ma2', blueprint: 'ma2' },
  { id: 'ma-science', name: 'ma-science', blueprint: 'ma-science' },
  { id: 'late-game-1', name: 'late game 1', blueprint: 'm1' },
  { id: 'late-game-2', name: 'late game 2', blueprint: 'm2' },
] as const;

const itemIds = (amounts: Amounts): Amounts =>
  Object.fromEntries(Object.entries(amounts).map(([id, n]) => [id.replace(/^item:/, ''), n]));

/** Construction inventories and per-item crafting costs, without research consumption or fuel. */
export function buildingList(
  data: MilestoneData,
  recipeData: StaticData['recipes'],
  blueprints: readonly { id: string; name: string; source: string; blueprint: Blueprint }[],
) {
  const milestones = blueprints.map(({ id, name, source, blueprint }) => {
    const { buildings } = blueprintMilestone(data, blueprint);
    return {
      id,
      name,
      source,
      buildingCount: Object.values(buildings).reduce((a, b) => a + b, 0),
      buildings,
    };
  });
  const recipes: Record<
    string,
    {
      product: string;
      outputAmount: number;
      expectedYield: boolean;
      timeSeconds: number;
      ingredients: Amounts;
    }
  > = {};
  const production: MilestoneData = {
    ...data,
    recipes: {},
    // The older accounting snapshot treats wood as gathered. Here it is grown instead.
    routes: { ...data.routes, 'item:wood': 'wood' },
  };
  const bases = BASE_INGREDIENTS.map((id) => `item:${id}`);
  const visiting = new Set<string>();
  const visit = (resource: string) => {
    if (bases.includes(resource)) return;
    if (visiting.has(resource)) throw new Error(`Production cycle: ${resource}`);
    const id = production.routes[resource];
    if (production.recipes[id]) return;
    const source = recipeData[id];
    if (!source) throw new Error(`Missing crafting recipe for ${resource}`);
    if (source.products.length !== 1 || source.products[0].resource !== resource)
      throw new Error(`Expected one product matching ${resource} in ${id}`);
    const product = source.products[0];
    const amount =
      'fixed' in product.amount
        ? product.amount.fixed
        : (product.amount.min + product.amount.max) / 2;
    const outputAmount = amount * product.probability;
    if (!Number.isFinite(outputAmount) || outputAmount <= 0)
      throw new Error(`Invalid output amount in ${id}`);
    if (!Number.isFinite(source.duration) || source.duration <= 0)
      throw new Error(`Invalid crafting time in ${id}`);
    const ingredients: Amounts = {};
    for (const ingredient of source.ingredients) {
      if (!ingredient.resource.startsWith('item:')) continue;
      ingredients[ingredient.resource] =
        (ingredients[ingredient.resource] ?? 0) + ingredient.amount;
    }
    const recipe: MilestoneRecipe = {
      product: resource,
      yield: outputAmount,
      expectedYield: !('fixed' in product.amount) || product.probability !== 1,
      ingredients: sorted(ingredients),
    };
    visiting.add(resource);
    for (const ingredient of Object.keys(ingredients)) visit(ingredient);
    visiting.delete(resource);
    production.recipes[id] = recipe;
    recipes[id] = {
      product: resource.slice(5),
      outputAmount,
      expectedYield: recipe.expectedYield,
      timeSeconds: source.duration,
      ingredients: itemIds(recipe.ingredients),
    };
  };
  const buildingIds = [
    ...new Set(milestones.flatMap((milestone) => Object.keys(milestone.buildings))),
  ].sort();
  for (const id of [...buildingIds, ...SCIENCE_PACKS]) visit(`item:${id}`);
  const unitCost = (id: string) => {
    const { materials, crafts } = bill(production, { [`item:${id}`]: 1 }, bases);
    return {
      recipe: production.routes[`item:${id}`],
      baseIngredients: itemIds(materials),
      crafts,
      totalCraftingTimeSeconds: Object.entries(crafts).reduce(
        (sum, [recipe, count]) => sum + recipes[recipe].timeSeconds * count,
        0,
      ),
    };
  };
  const buildings = Object.fromEntries(
    buildingIds.map((id) => {
      const cost = unitCost(id);
      return [
        id,
        {
          name: data.buildings[id].human,
          recipe: cost.recipe,
          baseIngredientsPerBuilding: cost.baseIngredients,
          craftsPerBuilding: cost.crafts,
          totalCraftingTimePerBuildingSeconds: cost.totalCraftingTimeSeconds,
        },
      ];
    }),
  );
  const sciencePacks = Object.fromEntries(
    SCIENCE_PACKS.map((id) => {
      const cost = unitCost(id);
      return [
        id,
        {
          name: recipeData[cost.recipe].human,
          recipe: cost.recipe,
          baseIngredientsPerPack: cost.baseIngredients,
          craftsPerPack: cost.crafts,
          totalCraftingTimePerPackSeconds: cost.totalCraftingTimeSeconds,
        },
      ];
    }),
  );
  return {
    accounting: {
      baseIngredients: BASE_INGREDIENTS,
      fluids: 'Ignored at every recipe depth; fluid production chains are excluded.',
      quantities:
        'Milestone counts are total placing items, independently of other milestones. Recipe ingredients and time are per craft; outputAmount is the yield per craft. Per-building and per-science-pack costs include every recursive craft, using fractional crafts and expected yields without batch rounding.',
      time: 'Seconds at crafting speed 1, without productivity or fuel. Total time sums all recursive crafts, including greenhouse wood growth; it is crafting work, not elapsed factory time.',
      scope:
        'Construction inventories and crafting costs for one automation, chemical, logistic or military science pack. Research consumption, configured production recipes beyond these packs, machine fuel and extra production machinery are excluded. Wood uses the water-only greenhouse recipe; coal is an additional mined base ingredient.',
    },
    milestones,
    buildings,
    sciencePacks,
    recipes: Object.fromEntries(Object.entries(recipes).sort(([a], [b]) => a.localeCompare(b))),
  };
}

if (import.meta.main) {
  const paths = {
    snapshot: 'docs/milestones/k2-data.json',
    static: 'src/assets/dataset/k2/static.json',
    recipes: 'src/assets/dataset/k2/recipes.json',
  };
  const [snapshotText, staticText, recipesText, ...blueprintTexts] = await Promise.all(
    [
      paths.snapshot,
      paths.static,
      paths.recipes,
      ...BUILDING_MILESTONES.map(({ blueprint }) => `docs/blueprints/${blueprint}.base64`),
    ].map((path) => readFile(path, 'utf8')),
  );
  const data = JSON.parse(snapshotText) as MilestoneData;
  if (
    data.provenance.staticSha256 !== sha256(staticText) ||
    data.provenance.recipesSha256 !== sha256(recipesText)
  )
    throw new Error('K2 milestone snapshot does not match the checked-in dataset');
  const staticData = decodeStaticData({
    ...JSON.parse(staticText),
    ...JSON.parse(recipesText),
  } as StaticDataPacked);
  const blueprints = BUILDING_MILESTONES.map(({ id, name, blueprint }, index) => ({
    id,
    name,
    source: `docs/blueprints/${blueprint}.base64`,
    blueprint: decode(blueprintTexts[index]),
  }));
  const output = {
    provenance: {
      ...data.provenance,
      sources: paths,
      snapshotSha256: sha256(snapshotText),
      blueprintHashes: Object.fromEntries(
        blueprints.map(({ id }, index) => [id, sha256(blueprintTexts[index])]),
      ),
    },
    ...buildingList(data, staticData.recipes, blueprints),
  };
  await writeFile(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT}`);
}
