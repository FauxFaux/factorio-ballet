import { netRates } from '../../flow.ts';
import { NO_EFFECTS } from '../../module-effects.ts';
import type { Recipe, ResourceId } from '../../types.ts';

const maxAssemblerStackHeight = 100;
const stackedDistrictGap = 2;

export interface BusColumn {
  inputs: { resource: ResourceId; rate: number }[];
  outputs: { resource: ResourceId; rate: number }[];
}

export interface BusLane {
  resource: ResourceId;
  transport: 'belt' | 'pipe';
  /** Zero is the lane closest to the assemblers. */
  lane: number;
  /** Column boundaries are 0 for imports and columns.length + 1 for exports. */
  start: number;
  end: number;
}

/**
 * Turn resource lifetimes into horizontal bus lanes. An item occupies one lane per whole belt of
 * peak flow; a fluid occupies one pipe. Finished intervals free their vertical lane immediately,
 * including at a column which turns one resource into another.
 */
export function busLaneLayout(
  columns: BusColumn[],
  imports: Iterable<ResourceId>,
  exports: Iterable<ResourceId>,
  itemsPerSecond: number,
): BusLane[] {
  const imported = new Set(imports);
  const exported = new Set(exports);
  const resources = new Map<
    ResourceId,
    {
      producers: number[];
      consumers: number[];
      inputRate: number;
      outputRate: number;
    }
  >();
  const role = (resource: ResourceId) => {
    const existing = resources.get(resource);
    if (existing) return existing;
    const created = { producers: [], consumers: [], inputRate: 0, outputRate: 0 };
    resources.set(resource, created);
    return created;
  };

  columns.forEach((column, index) => {
    const columnNumber = index + 1;
    for (const { resource, rate } of column.inputs) {
      const resourceRole = role(resource);
      resourceRole.consumers.push(columnNumber);
      resourceRole.inputRate += rate;
    }
    for (const { resource, rate } of column.outputs) {
      const resourceRole = role(resource);
      resourceRole.producers.push(columnNumber);
      resourceRole.outputRate += rate;
    }
  });
  for (const resource of imported) role(resource);
  for (const resource of exported) role(resource);

  const requests = [...resources]
    .flatMap(([resource, resourceRole]) => {
      const endpoints = [
        ...(imported.has(resource) ? [0] : []),
        ...resourceRole.producers,
        ...resourceRole.consumers,
        ...(exported.has(resource) ? [columns.length + 1] : []),
      ];
      const start = Math.min(...endpoints);
      const end = Math.max(...endpoints);
      if (!Number.isFinite(start) || start === end) return [];
      const transport: BusLane['transport'] = resource.startsWith('fluid:') ? 'pipe' : 'belt';
      const peakRate = Math.max(resourceRole.inputRate, resourceRole.outputRate);
      const count = transport === 'pipe' ? 1 : Math.ceil(peakRate / itemsPerSecond);
      return Array.from({ length: count }, () => ({ resource, transport, start, end }));
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || a.resource.localeCompare(b.resource));

  const occupiedUntil: number[] = [];
  return requests.map((request) => {
    let lane = occupiedUntil.findIndex((end) => end <= request.start);
    if (lane < 0) lane = occupiedUntil.length;
    occupiedUntil[lane] = request.end;
    return { ...request, lane };
  });
}

export function assemblerColumnLayout(
  machineWidth: number,
  machineHeight: number,
  count: number,
  inputBelts = 0,
  outputBelts = 0,
  inputPipes = 0,
  outputPipes = 0,
) {
  const rowsPerColumn = Math.max(1, Math.floor(maxAssemblerStackHeight / machineHeight));
  const columnCount = Math.ceil(count / rowsPerColumn);
  const inputBeltsPerColumn = beltsPerAssemblerColumn(inputBelts, columnCount);
  const outputBeltsPerColumn = beltsPerAssemblerColumn(outputBelts, columnCount);
  const inputPipesPerColumn = beltsPerAssemblerColumn(inputPipes, columnCount);
  const outputPipesPerColumn = beltsPerAssemblerColumn(outputPipes, columnCount);
  const inputTransportWidth = inputBeltsPerColumn + inputPipesPerColumn;
  const outputTransportWidth = outputBeltsPerColumn + outputPipesPerColumn;
  const inputBeltGap = inputTransportWidth > 0 ? 1 : 0;
  const outputBeltGap = outputTransportWidth > 0 ? 1 : 0;
  const columnHeights = Array.from(
    { length: columnCount },
    (_, column) => Math.min(rowsPerColumn, count - column * rowsPerColumn) * machineHeight,
  );
  const columnGap = Math.max(
    4,
    inputTransportWidth + inputBeltGap + outputBeltGap + outputTransportWidth,
  );

  return {
    assemblers: Array.from({ length: count }, (_, index) => ({
      column: Math.floor(index / rowsPerColumn),
      row: index % rowsPerColumn,
    })),
    height: Math.min(count, rowsPerColumn) * machineHeight,
    width:
      inputTransportWidth +
      inputBeltGap +
      columnCount * machineWidth +
      Math.max(0, columnCount - 1) * columnGap +
      outputBeltGap +
      outputTransportWidth,
    columnCount,
    columnHeights,
    columnGap,
    inputBeltsPerColumn,
    outputBeltsPerColumn,
    inputPipesPerColumn,
    outputPipesPerColumn,
    inputTransportWidth,
    outputTransportWidth,
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
  inputFlows: { resource: ResourceId; rate: number }[];
  inputFluids: ResourceId[];
  outputFlows: { resource: ResourceId; rate: number }[];
  outputFluids: ResourceId[];
}

export interface AssemblerStack {
  districts: (AssemblerDistrict & {
    layout: ReturnType<typeof assemblerColumnLayout>;
    y: number;
  })[];
  width: number;
  height: number;
  externalInputBelts: number;
  externalInputPipes: number;
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
      district.inputFluids.length,
      district.outputFluids.length,
    );
    const previous = stacks.at(-1);
    const previousDistrict = previous?.districts.at(-1)?.recipe;
    const canStack =
      previous !== undefined &&
      previousDistrict !== undefined &&
      previous.height + stackedDistrictGap + layout.height <= maxAssemblerStackHeight &&
      hasExclusiveHandoff(previousDistrict, district.recipe, roles);

    if (canStack) {
      previous.districts.push({
        ...district,
        layout,
        y: previous.height + stackedDistrictGap,
      });
      previous.width = Math.max(previous.width, layout.width);
      previous.height += stackedDistrictGap + layout.height;
    } else {
      stacks.push({
        districts: [{ ...district, layout, y: 0 }],
        width: layout.width,
        height: layout.height,
        externalInputBelts: 0,
        externalInputPipes: 0,
      });
    }
  }

  for (const stack of stacks) reserveExternalInputBelts(stack, itemsPerSecond);
  return stacks;
}

/** Inputs not made earlier in this stack share lanes which run from its top to its bottom. */
function reserveExternalInputBelts(stack: AssemblerStack, itemsPerSecond: number) {
  if (stack.districts.length === 1) return;

  const produced = new Set<ResourceId>();
  let externalInputRate = 0;
  const externalInputFluids = new Set<ResourceId>();

  for (const district of stack.districts) {
    for (const { resource, rate } of district.inputFlows) {
      if (resource.startsWith('item:') && !produced.has(resource)) externalInputRate += rate;
    }
    for (const resource of district.inputFluids) {
      if (!produced.has(resource)) externalInputFluids.add(resource);
    }
    for (const { resource } of district.outputFlows) produced.add(resource);
  }

  stack.externalInputBelts = Math.ceil(externalInputRate / itemsPerSecond);
  stack.externalInputPipes = externalInputFluids.size;
  stack.width = 0;
  for (const district of stack.districts) {
    district.layout = assemblerColumnLayout(
      district.machineWidth,
      district.machineHeight,
      district.count,
      stack.externalInputBelts,
      district.outputItemRate / itemsPerSecond,
      stack.externalInputPipes,
      district.outputFluids.length,
    );
    stack.width = Math.max(stack.width, district.layout.width);
  }
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
