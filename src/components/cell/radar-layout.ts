import { netRates } from '../../flow.ts';
import { NO_EFFECTS } from '../../module-effects.ts';
import type { Recipe, ResourceId } from '../../types.ts';

const maxAssemblerStackHeight = 100;

export function assemblerColumnLayout(
  machineWidth: number,
  machineHeight: number,
  count: number,
  inputBelts = 0,
  outputBelts = 0,
) {
  const rowsPerColumn = Math.max(1, Math.floor(maxAssemblerStackHeight / machineHeight));
  const columnCount = Math.ceil(count / rowsPerColumn);
  const inputBeltsPerColumn = beltsPerAssemblerColumn(inputBelts, columnCount);
  const outputBeltsPerColumn = beltsPerAssemblerColumn(outputBelts, columnCount);
  const inputBeltGap = inputBeltsPerColumn > 0 ? 1 : 0;
  const outputBeltGap = outputBeltsPerColumn > 0 ? 1 : 0;
  const columnGap = Math.max(
    4,
    inputBeltsPerColumn + inputBeltGap + outputBeltGap + outputBeltsPerColumn,
  );

  return {
    assemblers: Array.from({ length: count }, (_, index) => ({
      column: Math.floor(index / rowsPerColumn),
      row: index % rowsPerColumn,
    })),
    height: Math.min(count, rowsPerColumn) * machineHeight,
    width:
      inputBeltsPerColumn +
      inputBeltGap +
      columnCount * machineWidth +
      Math.max(0, columnCount - 1) * columnGap +
      outputBeltGap +
      outputBeltsPerColumn,
    columnCount,
    columnGap,
    inputBeltsPerColumn,
    outputBeltsPerColumn,
    inputBeltGap,
    outputBeltGap,
  };
}

/** Each assembler column gets enough whole belts to carry its share of a district's item flow. */
export function beltsPerAssemblerColumn(beltCount: number, columnCount: number): number {
  return Math.ceil(beltCount / columnCount);
}

export interface AssemblerDistrict {
  /** Stable render identity; the recipe object alone has no useful display key. */
  id: string;
  recipeId: string;
  recipeName: string;
  recipe: Recipe;
  machineWidth: number;
  machineHeight: number;
  count: number;
  inputItemRate: number;
  outputItemRate: number;
}

export interface AssemblerStack {
  districts: (AssemblerDistrict & {
    layout: ReturnType<typeof assemblerColumnLayout>;
    y: number;
  })[];
  width: number;
  height: number;
}

/**
 * Pack neighbouring recipe districts into a shared vertical assembler column when their hand-off
 * is private to them. A resource which has another maker or user needs its own route, so its
 * districts deliberately remain separate.
 */
export function stackAssemblerDistricts(
  districts: AssemblerDistrict[],
  itemsPerSecond = Number.POSITIVE_INFINITY,
): AssemblerStack[] {
  const roles = resourceRoles(districts);
  const stacks: AssemblerStack[] = [];

  for (const district of districts) {
    const layout = assemblerColumnLayout(
      district.machineWidth,
      district.machineHeight,
      district.count,
      district.inputItemRate / itemsPerSecond,
      district.outputItemRate / itemsPerSecond,
    );
    const previous = stacks.at(-1);
    const previousDistrict = previous?.districts.at(-1)?.recipe;
    const canStack =
      previous !== undefined &&
      previousDistrict !== undefined &&
      previous.height + layout.height <= maxAssemblerStackHeight &&
      hasExclusiveHandoff(previousDistrict, district.recipe, roles);

    if (canStack) {
      previous.districts.push({ ...district, layout, y: previous.height });
      previous.width = Math.max(previous.width, layout.width);
      previous.height += layout.height;
    } else {
      stacks.push({
        districts: [{ ...district, layout, y: 0 }],
        width: layout.width,
        height: layout.height,
      });
    }
  }

  return stacks;
}

function resourceRoles(districts: AssemblerDistrict[]) {
  const roles = new Map<ResourceId, { producers: Set<Recipe>; consumers: Set<Recipe> }>();
  for (const { recipe } of districts) {
    for (const [resource, rate] of netRates(recipe, recipe.duration, NO_EFFECTS)) {
      if (rate === 0) continue;
      const role = roles.get(resource) ?? {
        producers: new Set<Recipe>(),
        consumers: new Set<Recipe>(),
      };
      (rate > 0 ? role.producers : role.consumers).add(recipe);
      roles.set(resource, role);
    }
  }
  return roles;
}

function hasExclusiveHandoff(
  left: Recipe,
  right: Recipe,
  roles: Map<ResourceId, { producers: Set<Recipe>; consumers: Set<Recipe> }>,
) {
  for (const role of roles.values()) {
    if (
      role.producers.size === 1 &&
      role.producers.has(left) &&
      role.consumers.size === 1 &&
      role.consumers.has(right)
    ) {
      return true;
    }
  }
  return false;
}
