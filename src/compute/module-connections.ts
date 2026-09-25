import type { ResourceId } from '../types.ts';
import type { FactoryModule } from './modules.ts';

const EPSILON = 1e-8;

/** A directed share of one resource's production assigned to a consuming module. */
export interface ModuleConnection {
  producerId: string;
  consumerId: string;
  resource: ResourceId;
  rate: number;
}

export interface ModuleResourceRemainder {
  moduleId: string;
  resource: ResourceId;
  rate: number;
}

/** Internal transfers and the rates still needing an external source or destination. */
export interface ModuleFlowAllocation {
  connections: ModuleConnection[];
  unmetInputs: ModuleResourceRemainder[];
  unusedOutputs: ModuleResourceRemainder[];
}

interface FlowEdge {
  to: number;
  reverse: number;
  capacity: number;
}

function addEdge(graph: FlowEdge[][], from: number, to: number, capacity: number): FlowEdge {
  const forward = { to, reverse: graph[to]!.length, capacity };
  const reverse = { to: from, reverse: graph[from]!.length, capacity: 0 };
  graph[from]!.push(forward);
  graph[to]!.push(reverse);
  return forward;
}

/** Augment until no producer can reach an unmet consumer. */
function fillFlow(graph: FlowEdge[][], source: number, sink: number): void {
  while (true) {
    const parent: ({ from: number; edge: FlowEdge } | undefined)[] = Array(graph.length);
    const visited = new Set([source]);
    const queue = [source];
    for (let head = 0; head < queue.length && !visited.has(sink); head++) {
      const from = queue[head]!;
      for (const edge of graph[from]!) {
        if (edge.capacity <= EPSILON || visited.has(edge.to)) continue;
        visited.add(edge.to);
        parent[edge.to] = { from, edge };
        queue.push(edge.to);
      }
    }
    if (!visited.has(sink)) return;
    let rate = Infinity;
    for (let node = sink; node !== source;) {
      const step = parent[node]!;
      rate = Math.min(rate, step.edge.capacity);
      node = step.from;
    }
    for (let node = sink; node !== source;) {
      const step = parent[node]!;
      step.edge.capacity -= rate;
      graph[node]![step.edge.reverse]!.capacity += rate;
      node = step.from;
    }
  }
}

/** Match gross module outputs to inputs for each in-play resource.
 * A module cannot supply itself; its remaining rates stay explicit for later routing. */
export function allocateModuleFlows(
  modules: readonly FactoryModule[],
  resources: readonly ResourceId[],
): ModuleFlowAllocation {
  const allocation: ModuleFlowAllocation = {
    connections: [],
    unmetInputs: [],
    unusedOutputs: [],
  };
  for (const resource of new Set(resources)) {
    const producers = modules.filter((module) => (module.outputs[resource] ?? 0) > EPSILON);
    const consumers = modules.filter((module) => (module.inputs[resource] ?? 0) > EPSILON);
    const source = 0;
    const firstConsumer = producers.length + 1;
    const sink = firstConsumer + consumers.length;
    const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
    const supplies = producers.map((module, index) =>
      addEdge(graph, source, index + 1, module.outputs[resource]!),
    );
    const demands = consumers.map((module, index) =>
      addEdge(graph, firstConsumer + index, sink, module.inputs[resource]!),
    );
    const transfers = producers.flatMap((producer, producerIndex) =>
      consumers.flatMap((consumer, consumerIndex) =>
        producer.id === consumer.id
          ? []
          : [
              {
                producerId: producer.id,
                consumerId: consumer.id,
                edge: addEdge(
                  graph,
                  producerIndex + 1,
                  firstConsumer + consumerIndex,
                  Math.min(producer.outputs[resource]!, consumer.inputs[resource]!),
                ),
              },
            ],
      ),
    );
    fillFlow(graph, source, sink);
    for (const { producerId, consumerId, edge } of transfers) {
      const rate = graph[edge.to]![edge.reverse]!.capacity;
      if (rate > EPSILON) allocation.connections.push({ producerId, consumerId, resource, rate });
    }
    supplies.forEach((edge, index) => {
      if (edge.capacity > EPSILON)
        allocation.unusedOutputs.push({
          moduleId: producers[index]!.id,
          resource,
          rate: edge.capacity,
        });
    });
    demands.forEach((edge, index) => {
      if (edge.capacity > EPSILON)
        allocation.unmetInputs.push({
          moduleId: consumers[index]!.id,
          resource,
          rate: edge.capacity,
        });
    });
  }
  return allocation;
}
