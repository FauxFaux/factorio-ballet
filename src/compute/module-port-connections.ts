import type { ResourceId } from '../types.ts';
import type {
  CellFlowAllocation,
  ModuleConnection,
  StationConnection,
} from './module-connections.ts';
import type { ModulePort, FactoryModule } from './modules.ts';

const EPSILON = 1e-8;

/** One exposed transport lane or pipe endpoint on a module boundary. */
export type ModulePortReference = Pick<
  ModulePort,
  'edge' | 'x' | 'y' | 'transport' | 'direction'
> & {
  lane?: 'left' | 'right';
};

export interface AttachedModuleConnection extends ModuleConnection {
  producerPort: ModulePortReference;
  consumerPort: ModulePortReference;
}

export interface AttachedStationConnection extends StationConnection {
  modulePort: ModulePortReference;
}

export interface PortAssignedFlows {
  connections: AttachedModuleConnection[];
  stationConnections: AttachedStationConnection[];
  unattached: (
    | { kind: 'module'; connection: ModuleConnection }
    | { kind: 'station'; connection: StationConnection }
  )[];
}

interface PortBudget {
  port: ModulePortReference;
  remaining: number;
}

function budgetsFor(
  module: FactoryModule,
  resource: ResourceId,
  side: 'input' | 'output',
): PortBudget[] {
  const preferredEdge = side === 'input' ? 'bottom' : 'top';
  const tracks = new Map<string, PortBudget>();
  for (const port of module.ports) {
    const add = (lane: 'left' | 'right' | undefined, rate: number) => {
      if (rate <= EPSILON) return;
      const key = `${port.x}:${port.y ?? 'end'}:${lane ?? 'pipe'}`;
      const existing = tracks.get(key);
      if (existing && existing.port.edge === preferredEdge) return;
      if (!existing || port.edge === preferredEdge)
        tracks.set(key, {
          port: {
            edge: port.edge,
            x: port.x,
            ...(port.y === undefined ? {} : { y: port.y }),
            transport: port.transport,
            ...(port.direction ? { direction: port.direction } : {}),
            ...(lane ? { lane } : {}),
          },
          remaining: rate,
        });
    };
    for (const lane of ['left', 'right'] as const) {
      const flow = port.lanes?.[lane];
      if (flow?.resource === resource && flow.side === side) add(lane, flow.rate);
    }
    if (port.fluid?.resource === resource)
      add(undefined, side === 'input' ? port.fluid.inputRate : port.fluid.outputRate);
  }
  return [...tracks.values()];
}

/** Give every logical flow an actual module port; split flows when lanes have separate budgets. */
export function assignModulePorts(
  modules: readonly FactoryModule[],
  allocation: CellFlowAllocation,
): PortAssignedFlows {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const budgets = new Map<string, PortBudget[]>();
  const available = (moduleId: string, resource: ResourceId, side: 'input' | 'output') => {
    const key = JSON.stringify([moduleId, resource, side]);
    let slots = budgets.get(key);
    if (!slots) {
      const module = byId.get(moduleId);
      slots = module ? budgetsFor(module, resource, side) : [];
      budgets.set(key, slots);
    }
    return slots.find((slot) => slot.remaining > EPSILON);
  };
  const result: PortAssignedFlows = { connections: [], stationConnections: [], unattached: [] };
  for (const connection of allocation.connections) {
    let remaining = connection.rate;
    while (remaining > EPSILON) {
      const producer = available(connection.producerId, connection.resource, 'output');
      const consumer = available(connection.consumerId, connection.resource, 'input');
      if (!producer || !consumer) break;
      const rate = Math.min(remaining, producer.remaining, consumer.remaining);
      result.connections.push({
        ...connection,
        rate,
        producerPort: producer.port,
        consumerPort: consumer.port,
      });
      producer.remaining -= rate;
      consumer.remaining -= rate;
      remaining -= rate;
    }
    if (remaining > EPSILON)
      result.unattached.push({ kind: 'module', connection: { ...connection, rate: remaining } });
  }
  for (const connection of allocation.stationConnections) {
    let remaining = connection.rate;
    while (remaining > EPSILON) {
      const slot = available(connection.moduleId, connection.resource, connection.side);
      if (!slot) break;
      const rate = Math.min(remaining, slot.remaining);
      result.stationConnections.push({ ...connection, rate, modulePort: slot.port });
      slot.remaining -= rate;
      remaining -= rate;
    }
    if (remaining > EPSILON)
      result.unattached.push({ kind: 'station', connection: { ...connection, rate: remaining } });
  }
  return result;
}
