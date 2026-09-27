import type { LayoutRequest } from '../../assets/tala/index.js';
import type { FactoryModule } from '../../compute/modules.ts';
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
} from '../../compute/module-port-connections.ts';
import type { Position } from '../../bp/decode.ts';
import { INPUT_STATION_BOUNDS, OUTPUT_STATION_BOUNDS } from './station-footprint.tsx';

/** The same module and station flow graph used by the footprint layout, with TALA-safe IDs. */
export function talaGraph(
  modules: readonly FactoryModule[],
  connections: readonly AttachedModuleConnection[],
  stationConnections: readonly AttachedStationConnection[],
  inputStationStops: readonly Position[],
  outputStationStops: readonly Position[],
): LayoutRequest {
  const moduleIds = new Map(modules.map((module, index) => [module.id, `module_${index}`]));
  const nodes: LayoutRequest['nodes'] = modules.map((module, index) => ({
    id: `module_${index}`,
    width: module.size.width,
    height: module.size.height,
  }));
  for (const [side, stops, bounds] of [
    ['input', inputStationStops, INPUT_STATION_BOUNDS],
    ['output', outputStationStops, OUTPUT_STATION_BOUNDS],
  ] as const) {
    stops.forEach((_stop, index) => {
      nodes.push({
        id: `${side}_${index}`,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
      });
    });
  }
  const edges: LayoutRequest['edges'] = [];
  for (const connection of connections) {
    const source = moduleIds.get(connection.producerId);
    const target = moduleIds.get(connection.consumerId);
    if (source && target) edges.push({ id: `edge_${edges.length}`, source, target });
  }
  for (const connection of stationConnections) {
    const moduleId = moduleIds.get(connection.moduleId);
    const stops = connection.side === 'input' ? inputStationStops : outputStationStops;
    if (!moduleId || !stops[connection.stationIndex]) continue;
    const stationId = `${connection.side}_${connection.stationIndex}`;
    edges.push({
      id: `edge_${edges.length}`,
      source: connection.side === 'input' ? stationId : moduleId,
      target: connection.side === 'input' ? moduleId : stationId,
    });
  }
  return { direction: 'right', nodes, edges };
}
