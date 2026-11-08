import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RawData } from 'factorio-raw-types/prototypes';
import { analyse } from '../complexity.ts';
import { ITEM_KEYS } from '../raw-keys.ts';
import { arr, isProduced, RIngredient, RLocale, RProduct } from '../raw-validators.ts';
import { resolveLocale } from '../locale.ts';
import { entriesOf } from '../../src/ts.ts';
import { researchFor, sorted } from './model.ts';
import type { Amounts, MilestoneData, MilestoneRecipe } from './model.ts';

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Structural view for discovering entity types; items and recipes remain raw-types checked. */
interface CraftingEntity {
  type: string;
  name: string;
  collision_box?: unknown;
  crafting_categories?: string[];
  placeable_by?: { item: string; count: number };
}

export async function extract(
  app: string,
  configuredRecipes: readonly string[] = [],
): Promise<MilestoneData> {
  const dump = await readFile(resolve(app, 'script-output/data-raw-dump.json'), 'utf8');
  const raw = JSON.parse(dump) as RawData;
  if (!raw.recipe['kr-basic-tech-card'] || !raw.recipe['kr-automation-core']) {
    throw new Error('Expected the K2 export documented in docs/guides/INGEST.md');
  }
  const locales: Record<string, RLocale> = {};
  for (const type of ['item', 'technology']) {
    locales[type] = RLocale.parse(
      JSON.parse(await readFile(resolve(app, `script-output/${type}-locale.json`), 'utf8')),
    );
  }
  const analysis = analyse(raw);
  const scale = Math.log10(1 + analysis.max);
  const entities = new Map<string, CraftingEntity>();
  for (const group of Object.values(
    raw as unknown as Record<string, Record<string, CraftingEntity>>,
  )) {
    for (const p of Object.values(group)) if (p.collision_box) entities.set(p.name, p);
  }
  const items = ITEM_KEYS.flatMap((key) => entriesOf(raw[key] ?? {})).filter(
    ([, p]) => !p.hidden && !p.parameter,
  );
  const cutoff = analysis.costs.get('item:electric-furnace');
  if (cutoff === undefined) throw new Error('Missing electric-furnace complexity');
  const buildings: MilestoneData['buildings'] = {};
  for (const [id, item] of items) {
    if (!item.place_result) continue;
    const cost = analysis.costs.get(`item:${id}`) ?? Infinity;
    if (cost > cutoff && id !== 'flamethrower-turret') continue;
    const entity = entities.get(item.place_result);
    if (!entity) throw new Error(`Missing placed entity: ${item.place_result}`);
    if (['tree', 'simple-entity'].includes(entity.type)) continue;
    const placing = entity.placeable_by;
    if (placing && placing.item !== id) throw new Error(`Ambiguous placement for ${id}`);
    buildings[id] = {
      human: resolveLocale(id, locales, 'item') ?? id,
      entity: item.place_result,
      type: entity.type,
      complexity: analysis.progress.get(`item:${id}`) ?? 0,
      placeCount: placing?.count ?? 1,
    };
  }

  const technologies: MilestoneData['technologies'] = {};
  const unlocks = new Map<string, string[]>();
  for (const [id, tech] of Object.entries(raw.technology)) {
    if (tech.hidden) continue;
    const science: Amounts = {};
    if (tech.unit?.count !== undefined) {
      for (const [pack, amount] of arr(tech.unit.ingredients))
        science[pack] = amount * tech.unit.count;
    }
    const unlocked = arr(tech.effects ?? [])
      .filter((e) => e.type === 'unlock-recipe')
      .map((e) => e.recipe);
    technologies[id] = {
      human: resolveLocale(id, locales, 'technology') ?? id,
      prerequisites: arr(tech.prerequisites ?? []),
      science,
      complexity: Math.log10(1 + (analysis.techCost.get(id) ?? 0)) / scale,
      unlocks: unlocked,
      ...(tech.research_trigger ? { trigger: tech.research_trigger } : {}),
      ...(tech.unit?.count_formula ? { formula: tech.unit.count_formula } : {}),
    };
    for (const recipe of unlocked) unlocks.set(recipe, [...(unlocks.get(recipe) ?? []), id]);
  }

  const boundaries: MilestoneData['boundaries'] = {
    raw: [
      'item:iron-ore',
      'item:copper-ore',
      'item:stone',
      'item:coal',
      'item:wood',
      'item:kr-biomass',
      'fluid:water',
      'fluid:crude-oil',
    ],
    plates: [
      'item:iron-plate',
      'item:copper-plate',
      'item:stone',
      'item:coal',
      'item:wood',
      'item:kr-biomass',
      'fluid:water',
      'fluid:crude-oil',
      'item:iron-ore',
      'item:copper-ore',
    ],
  };
  const data: MilestoneData = {
    provenance: {
      dataset: 'Factorio 2.1.21 / Krastorio2 2.1.3 (enabled mods: docs/guides/INGEST.md)',
      rawSha256: sha256(dump),
      staticSha256: sha256(await readFile('src/assets/dataset/k2/static.json', 'utf8')),
      recipesSha256: sha256(await readFile('src/assets/dataset/k2/recipes.json', 'utf8')),
    },
    boundaries,
    technologies,
    buildings,
    recipes: {},
    routes: {},
  };
  const visited = new Set<string>();
  const route = (resource: string) => {
    if (boundaries.raw.includes(resource) || visited.has(resource)) return;
    visited.add(resource);
    // Never choose enrichment, recycling, barrel loops, greenhouse growth, or advanced oil by
    // accident. The same-name early route is intentional; petroleum is the one explicit exception.
    const id =
      resource === 'fluid:petroleum-gas'
        ? 'basic-oil-processing'
        : resource.slice(resource.indexOf(':') + 1);
    const recipe = normalize(id);
    if (recipe.product !== resource) throw new Error(`Route ${id} does not make ${resource}`);
    data.routes[resource] = id;
  };
  const normalize = (id: string): MilestoneRecipe => {
    if (data.recipes[id]) return data.recipes[id];
    const rawRecipe = raw.recipe[id];
    if (!rawRecipe || rawRecipe.hidden || rawRecipe.parameter)
      throw new Error(`Missing live early recipe: ${id}`);
    const products = arr(rawRecipe.results ?? [])
      .map((p) => RProduct.parse(p))
      .filter(isProduced);
    if (products.length !== 1) throw new Error(`Explicit coproduct policy required for ${id}`);
    const product = products[0];
    if (product.shared_probability || product.extra_count_fraction)
      throw new Error(`Unsupported product distribution in ${id}`);
    const amount = product.amount ?? ((product.amount_min ?? 0) + (product.amount_max ?? 0)) / 2;
    const probability = product.probability ?? product.independent_probability ?? 1;
    const ingredients: Amounts = {};
    for (const ingredient of arr(rawRecipe.ingredients ?? [])) {
      const i = RIngredient.parse(ingredient);
      const key = `${i.type}:${i.name}`;
      ingredients[key] = (ingredients[key] ?? 0) + i.amount;
    }
    const technologies = (unlocks.get(id) ?? []).toSorted(
      (a, b) =>
        (analysis.techCost.get(a) ?? Infinity) - (analysis.techCost.get(b) ?? Infinity) ||
        a.localeCompare(b),
    );
    const technology = rawRecipe.enabled === false ? technologies[0] : undefined;
    if (rawRecipe.enabled === false && !technology) throw new Error(`No unlock for ${id}`);
    const categories = (rawRecipe as typeof rawRecipe & { categories?: string[] }).categories ?? [
      rawRecipe.category ?? 'crafting',
    ];
    const handCraftable = arr(raw.character.character.crafting_categories ?? []).some((c) =>
      categories.includes(c),
    );
    const machine = handCraftable
      ? undefined
      : items
          .filter(
            ([, p]) =>
              p.place_result &&
              arr(entities.get(p.place_result)?.crafting_categories ?? []).some((c) =>
                categories.includes(c),
              ),
          )
          .map(([name]) => name)
          .sort(
            (a, b) =>
              (analysis.costs.get(`item:${a}`) ?? Infinity) -
                (analysis.costs.get(`item:${b}`) ?? Infinity) || a.localeCompare(b),
          )[0];
    if (!handCraftable && !machine) throw new Error(`No crafting machine for ${id}`);
    const recipe: MilestoneRecipe = {
      product: `${product.type}:${product.name}`,
      yield: amount * probability,
      expectedYield: product.amount === undefined || probability !== 1,
      ingredients: sorted(ingredients),
      ...(technology ? { technology } : {}),
      ...(machine ? { machine } : {}),
    };
    data.recipes[id] = recipe;
    for (const ingredient of Object.keys(ingredients)) route(ingredient);
    if (machine) route(`item:${machine}`);
    return recipe;
  };
  for (const id of Object.keys(buildings)) route(`item:${id}`);
  for (const pack of [
    'kr-basic-tech-card',
    'automation-science-pack',
    'logistic-science-pack',
    'military-science-pack',
    'chemical-science-pack',
  ])
    route(`item:${pack}`);
  for (const id of configuredRecipes) normalize(id);
  // Verify the complete supported catalogue, including technologies needed to make its cards.
  for (const id of Object.keys(buildings))
    researchFor(data, { buildings: { [id]: 1 }, recipes: [], technologies: [] });
  return data;
}
