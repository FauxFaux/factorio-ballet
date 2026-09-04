import type { Ingredient, Product, ResourceId, StaticData, StaticDataPacked } from '../types.ts';

const staticDataJson = await import('../assets/static.json');
const staticRecipesJson = await import('../assets/static-recipes.json');

const packed = {
  ...(staticDataJson.default as unknown as Omit<StaticDataPacked, 'recipes'>),
  recipes: staticRecipesJson.default.recipes,
} as StaticDataPacked;

const decodeAmount = (amount: { f: number } | { n: number; x: number }): Product['amount'] =>
  'f' in amount ? { fixed: amount.f } : { min: amount.n, max: amount.x };

const decodeTemperature = (
  temperature: { f: number } | { n: number; x: number } | { n: number } | { x: number },
): Ingredient['temperature'] => {
  if ('f' in temperature) return { fixed: temperature.f };
  if ('n' in temperature && 'x' in temperature) return { min: temperature.n, max: temperature.x };
  if ('n' in temperature) return { min: temperature.n };
  return { max: temperature.x };
};

function decodeStaticData(data: StaticDataPacked): StaticData {
  const resourceIds = Object.keys(data.resources) as ResourceId[];
  const resourceId = (index: number): ResourceId => {
    const id = resourceIds[index];
    if (id === undefined) throw new Error(`Missing resource index ${index}`);
    return id;
  };

  return {
    recipes: Object.fromEntries(
      Object.entries(data.recipes).map(([id, recipe]) => [
        id,
        {
          human: recipe.h,
          ingredients: recipe.i.map((ingredient) => ({
            resource: resourceId(ingredient.r),
            amount: ingredient.a,
            temperature: ingredient.t && decodeTemperature(ingredient.t),
          })),
          products: recipe.p.map((product) => ({
            resource: resourceId(product.r),
            amount: decodeAmount(product.a),
            probability: product.p,
            ignoredByProductivity: product.i,
          })),
          duration: recipe.d,
          categories: recipe.c,
          allowProductivity: recipe.a,
          synthetic: recipe.s,
          complexity: recipe.x,
        },
      ]),
    ),
    resources: Object.fromEntries(
      Object.entries(data.resources).map(([id, resource]) => [
        id,
        {
          human: resource.h,
          stackSize: resource.z,
          complexity: resource.x,
        },
      ]),
    ),
    machines: Object.fromEntries(
      Object.entries(data.machines).map(([id, machine]) => [
        id,
        {
          human: machine.h,
          kind: machine.k,
          item: machine.i,
          categories: machine.c,
          speed: machine.s,
          size: machine.z,
          fluidboxConnectionPoints: machine.f,
          moduleSlots: machine.n,
          allowedEffects: machine.e,
          allowedModuleCategories: machine.a,
        },
      ]),
    ),
    modules: Object.fromEntries(
      Object.entries(data.modules).map(([id, module]) => [
        id,
        {
          category: module.c,
          tier: module.t,
          speed: module.s,
          productivity: module.p,
        },
      ]),
    ),
    beacons: Object.fromEntries(
      Object.entries(data.beacons).map(([id, beacon]) => [
        id,
        {
          human: beacon.h,
          item: beacon.i,
          moduleSlots: beacon.n,
          distributionEffectivity: beacon.d,
          allowedEffects: beacon.e,
          allowedModuleCategories: beacon.a,
        },
      ]),
    ),
    belts: Object.fromEntries(
      Object.entries(data.belts).map(([id, belt]) => [
        id,
        {
          human: belt.h,
          item: belt.i,
          itemsPerSecond: belt.s,
        },
      ]),
    ),
    sciencePacks: data.sciencePacks,
  };
}

export const staticData = decodeStaticData(packed);
