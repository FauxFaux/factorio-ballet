import type { RoutingDebugEntity, RoutingDebugState } from '../../boot/url-handler.tsx';
import { solveConflictRouting } from './conflict-search.ts';
import { normalizeRoutingDebugEndpoints, normalizeRoutingDebugGrid } from './path-search.ts';
import type { RoutingOptions, RoutingRequest, RoutingResult, RoutingSolver } from './types.ts';

/**
 * Route exactly-one-source/exactly-one-sink items together. Unpaired or ambiguous items remain
 * obstacles but do not acquire routes. Geometry is rasterized once; rates are not allocated here.
 * The normalized grid/result contract lets callers replace the algorithm without changing UI state.
 */
export function solveRoutingDebug(
  state: RoutingDebugState,
  options: RoutingOptions = state.routingOptions ?? {},
  solver: RoutingSolver = solveConflictRouting,
): RoutingResult {
  const normalized = normalizeRoutingDebugGrid(state);
  if (normalized.kind !== 'ok') return normalized;
  const byItem = new Map<string, { source: RoutingDebugEntity[]; sink: RoutingDebugEntity[] }>();
  for (const entity of state.entities ?? []) {
    let endpoints = byItem.get(entity.item);
    if (!endpoints) {
      endpoints = { source: [], sink: [] };
      byItem.set(entity.item, endpoints);
    }
    endpoints[entity.kind].push(entity);
  }
  const routes: RoutingRequest[] = [];
  for (const [id, { source, sink }] of byItem) {
    if (source.length !== 1 || sink.length !== 1) continue;
    const endpoints = normalizeRoutingDebugEndpoints(state, normalized.grid, source[0], sink[0]);
    if (endpoints.kind !== 'ok') return endpoints;
    routes.push({ id, start: endpoints.input.start, goal: endpoints.input.goal });
  }
  return solver({ ...normalized.grid, routes }, options);
}
