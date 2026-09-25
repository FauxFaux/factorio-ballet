import type {
  ChartColor,
  Ingredient,
  Product,
  ResourceId,
  StaticData,
  StaticDataPacked,
} from '../types.ts';

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

export function decodeStaticData(data: StaticDataPacked): StaticData {
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
            fluidboxIndex: ingredient.f,
          })),
          products: recipe.p.map((product) => ({
            resource: resourceId(product.r),
            amount: decodeAmount(product.a),
            probability: product.p,
            ignoredByProductivity: product.i,
            fluidboxIndex: product.f,
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
          fluidBoxes: machine.f?.map((box) => ({
            productionType: box.p,
            connections: box.c.map((connection) => ({
              position: { x: connection.p[0], y: connection.p[1] },
              direction: connection.d,
              flowDirection: connection.f,
            })),
          })),
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
          undergroundLength: belt.u,
        },
      ]),
    ),
    inserters: Object.fromEntries(
      Object.entries(data.inserters).map(([id, inserter]) => [
        id,
        {
          human: inserter.h,
          item: inserter.i,
          rotationSpeed: inserter.r,
          extensionSpeed: inserter.e,
          pickupPosition: { x: inserter.p[0], y: inserter.p[1] },
          insertPosition: { x: inserter.d[0], y: inserter.d[1] },
          baseStackSize: inserter.z,
          bulk: inserter.b,
          stackSizeBonus: inserter.s,
          maxBeltStackSize: inserter.m,
          grabLessToMatchBeltStack: inserter.g,
          waitForFullHand: inserter.w,
          startingDistance: inserter.x,
          usesInserterStackSizeBonus: inserter.u,
        },
      ]),
    ),
    inserterCapacityBonuses: data.inserterCapacityBonuses,
    entities: Object.fromEntries(
      Object.entries(data.entities).map(([id, entity]) => [
        id,
        {
          size: { width: entity.z[0], height: entity.z[1] },
          chartColor: [
            Number.parseInt(entity.c.slice(0, 2), 16) / 255,
            Number.parseInt(entity.c.slice(2, 4), 16) / 255,
            Number.parseInt(entity.c.slice(4, 6), 16) / 255,
          ] as ChartColor,
        },
      ]),
    ),
    sciencePacks: data.sciencePacks,
    suggestionPreload: {
      fromAirRecipeByProduct: data.suggestionPreload.f as Record<ResourceId, string>,
      fromAirOneStepProducts: data.suggestionPreload.o,
      singleStepVoidableResources: data.suggestionPreload.v,
    },
  };
}
