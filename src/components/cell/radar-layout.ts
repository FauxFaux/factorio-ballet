import type { ResourceId } from '../../types.ts';

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
