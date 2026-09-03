import type {
  Ingredient,
  Product,
  ResourceId,
  StaticData,
  StaticDataPacked,
} from '../src/types.ts';

/** Compact the generated data while preserving insertion order for indexed resources. */
export function packStaticData(data: StaticData): StaticDataPacked {
  const resourceIds = Object.keys(data.resources) as ResourceId[];
  const resourceIndexes = new Map(resourceIds.map((id, index) => [id, index]));
  const resourceIndex = (id: ResourceId): number => {
    const index = resourceIndexes.get(id);
    if (index === undefined) throw new Error(`Missing resource ${id}`);
    return index;
  };

  return {
    recipes: Object.fromEntries(
      Object.entries(data.recipes).map(([id, recipe]) => [
        id,
        {
          h: recipe.human,
          i: recipe.ingredients.map((ingredient) => ({
            r: resourceIndex(ingredient.resource),
            a: ingredient.amount,
            t: ingredient.temperature && packTemperature(ingredient.temperature),
          })),
          p: recipe.products.map((product) => ({
            r: resourceIndex(product.resource),
            a: packAmount(product.amount),
            p: product.probability,
            i: product.ignoredByProductivity,
          })),
          d: recipe.duration,
          c: recipe.categories,
          a: recipe.allowProductivity,
          s: recipe.synthetic,
          x: recipe.complexity,
        },
      ]),
    ),
    resources: Object.fromEntries(
      Object.entries(data.resources).map(([id, resource]) => [
        id,
        {
          h: resource.human,
          z: resource.stackSize,
          x: resource.complexity,
        },
      ]),
    ),
    machines: Object.fromEntries(
      Object.entries(data.machines).map(([id, machine]) => [
        id,
        {
          h: machine.human,
          k: machine.kind,
          i: machine.item,
          c: machine.categories,
          s: machine.speed,
          n: machine.moduleSlots,
          e: machine.allowedEffects,
          a: machine.allowedModuleCategories,
        },
      ]),
    ),
    modules: Object.fromEntries(
      Object.entries(data.modules).map(([id, module]) => [
        id,
        {
          c: module.category,
          t: module.tier,
          s: module.speed,
          p: module.productivity,
        },
      ]),
    ),
    beacons: Object.fromEntries(
      Object.entries(data.beacons).map(([id, beacon]) => [
        id,
        {
          h: beacon.human,
          i: beacon.item,
          n: beacon.moduleSlots,
          d: beacon.distributionEffectivity,
          e: beacon.allowedEffects,
          a: beacon.allowedModuleCategories,
        },
      ]),
    ),
    belts: Object.fromEntries(
      Object.entries(data.belts).map(([id, belt]) => [
        id,
        {
          h: belt.human,
          i: belt.item,
          s: belt.itemsPerSecond,
        },
      ]),
    ),
    sciencePacks: data.sciencePacks,
  };
}

function packAmount(
  amount: Product['amount'],
): StaticDataPacked['recipes'][string]['p'][number]['a'] {
  return 'fixed' in amount ? { f: amount.fixed } : { n: amount.min, x: amount.max };
}

function packTemperature(
  temperature: NonNullable<Ingredient['temperature']>,
): NonNullable<StaticDataPacked['recipes'][string]['i'][number]['t']> {
  if ('fixed' in temperature) return { f: temperature.fixed };
  if ('min' in temperature && 'max' in temperature)
    return { n: temperature.min, x: temperature.max };
  if ('min' in temperature) return { n: temperature.min };
  return { x: temperature.max };
}
