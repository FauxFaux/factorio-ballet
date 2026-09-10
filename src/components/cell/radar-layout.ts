import { netRates } from '../../flow.ts';
import { NO_EFFECTS } from '../../module-effects.ts';
import type { Recipe, ResourceId } from '../../types.ts';

const maxAssemblerStackHeight = 100;
const stackedDistrictGap = 2;

export interface BusFlow {
  resource: ResourceId;
  rate: number;
  /** The district whose vertical transport connects this flow to the bus. */
  districtId?: string;
}

export interface BusColumn {
  /** Stable across geometry changes; normally derived from the districts packed into the column. */
  id?: string;
  inputs: BusFlow[];
  outputs: BusFlow[];
}

export type BusConnectionKind = 'import' | 'produce' | 'consume' | 'export';

/** One vertical leg or external endpoint on a resource's end-to-end route. */
export interface BusRouteConnection {
  id: string;
  kind: BusConnectionKind;
  /** Imports/producers feed the bus; consumers/exports drain it. */
  busDirection: 'onto-bus' | 'off-bus';
  /** Imports use 0; exports use columnCount + 1. */
  column: number;
  columnId?: string;
  districtIds: string[];
  stationId?: string;
  stationIndex?: number;
  /** Gross solved rate at assembler connections; boundaries do not currently expose a rate. */
  rate?: number;
}

/** The semantic route shared by all physical lanes carrying one resource. */
export interface BusRoute {
  id: string;
  resource: ResourceId;
  transport: 'belt' | 'pipe';
  throughput: number;
  laneCount: number;
  start: number;
  end: number;
  connections: BusRouteConnection[];
}

export interface BusLane {
  id: string;
  routeId: string;
  resource: ResourceId;
  transport: 'belt' | 'pipe';
  /** This physical lane's index within its resource route. */
  routeLane: number;
  /** Zero is the lane closest to the assemblers. */
  lane: number;
  /** Column boundaries are 0 for imports and columns.length + 1 for exports. */
  start: number;
  end: number;
}

export interface BusLayout {
  routes: BusRoute[];
  lanes: BusLane[];
}

/** The highest bus lane used by one transport bank, if any of its resources reach the bus. */
export function busConnectionTopLane(
  busLanes: BusLane[],
  flows: { resource: ResourceId }[],
  transport: BusLane['transport'],
): number | undefined {
  const resources = new Set(flows.map(({ resource }) => resource));
  let topLane: number | undefined;
  for (const busLane of busLanes) {
    if (busLane.transport !== transport || !resources.has(busLane.resource)) continue;
    topLane = Math.max(topLane ?? busLane.lane, busLane.lane);
  }
  return topLane;
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
  return busLayout(columns, imports, exports, itemsPerSecond).lanes;
}

/** Build both the semantic resource routes and their packed physical horizontal lanes. */
export function busLayout(
  columns: BusColumn[],
  imports: Iterable<ResourceId>,
  exports: Iterable<ResourceId>,
  itemsPerSecond: number,
): BusLayout {
  const imported = [...imports];
  const exported = [...exports];
  const resources = new Map<
    ResourceId,
    {
      inputRate: number;
      outputRate: number;
      connections: Map<string, BusRouteConnection>;
    }
  >();
  const role = (resource: ResourceId) => {
    const existing = resources.get(resource);
    if (existing) return existing;
    const created = {
      inputRate: 0,
      outputRate: 0,
      connections: new Map<string, BusRouteConnection>(),
    };
    resources.set(resource, created);
    return created;
  };
  const connect = (
    resource: ResourceId,
    kind: BusConnectionKind,
    column: number,
    columnId?: string,
    flow?: BusFlow,
    stationIndex?: number,
  ) => {
    const resourceRole = role(resource);
    const key = `${kind}:${column}`;
    const existing = resourceRole.connections.get(key);
    const districtIds = new Set(existing?.districtIds);
    if (flow?.districtId) districtIds.add(flow.districtId);
    resourceRole.connections.set(key, {
      id: `bus:${resource}:${key}`,
      kind,
      busDirection: kind === 'import' || kind === 'produce' ? 'onto-bus' : 'off-bus',
      column,
      ...(columnId ? { columnId } : {}),
      districtIds: [...districtIds],
      ...(stationIndex === undefined
        ? {}
        : { stationId: `station:${kind}:${resource}`, stationIndex }),
      ...(flow ? { rate: (existing?.rate ?? 0) + flow.rate } : {}),
    });
  };

  columns.forEach((column, index) => {
    const columnNumber = index + 1;
    for (const flow of column.inputs) {
      const { resource, rate } = flow;
      const resourceRole = role(resource);
      resourceRole.inputRate += rate;
      connect(resource, 'consume', columnNumber, column.id, flow);
    }
    for (const flow of column.outputs) {
      const { resource, rate } = flow;
      const resourceRole = role(resource);
      resourceRole.outputRate += rate;
      connect(resource, 'produce', columnNumber, column.id, flow);
    }
  });
  imported.forEach((resource, stationIndex) =>
    connect(resource, 'import', 0, undefined, undefined, stationIndex),
  );
  exported.forEach((resource, stationIndex) =>
    connect(resource, 'export', columns.length + 1, undefined, undefined, stationIndex),
  );

  const routes = [...resources]
    .flatMap(([resource, resourceRole]) => {
      const connections = [...resourceRole.connections.values()].sort(
        (a, b) => a.column - b.column || a.kind.localeCompare(b.kind),
      );
      const endpoints = connections.map(({ column }) => column);
      const start = Math.min(...endpoints);
      const end = Math.max(...endpoints);
      if (!Number.isFinite(start) || start === end) return [];
      const transport: BusRoute['transport'] = resource.startsWith('fluid:') ? 'pipe' : 'belt';
      const throughput = Math.max(resourceRole.inputRate, resourceRole.outputRate);
      const laneCount = transport === 'pipe' ? 1 : Math.ceil(throughput / itemsPerSecond);
      return [
        {
          id: `bus:${resource}`,
          resource,
          transport,
          throughput,
          laneCount,
          start,
          end,
          connections,
        },
      ];
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || a.resource.localeCompare(b.resource));

  const occupiedUntil: number[] = [];
  const lanes = routes.flatMap((route) =>
    Array.from({ length: route.laneCount }, (_, routeLane) => {
      let lane = occupiedUntil.findIndex((end) => end <= route.start);
      if (lane < 0) lane = occupiedUntil.length;
      occupiedUntil[lane] = route.end;
      return {
        id: `${route.id}:lane:${routeLane}`,
        routeId: route.id,
        resource: route.resource,
        transport: route.transport,
        routeLane,
        lane,
        start: route.start,
        end: route.end,
      };
    }),
  );
  return { routes, lanes };
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
    machineWidth,
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
  const machineWidth = Math.max(...stack.districts.map((district) => district.machineWidth));
  stack.width = 0;
  for (const district of stack.districts) {
    district.layout = assemblerColumnLayout(
      machineWidth,
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
