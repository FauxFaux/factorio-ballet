import type { FactoryModule } from '../modules.ts';
import type { ModuleFlowAllocation, ModuleConnection } from '../module-connections.ts';
import type { ResourceId } from '../../types.ts';

const EPSILON = 1e-8;
interface Edge {
  to: number;
  reverse: number;
  capacity: number;
}
interface Transfer {
  producer: number;
  consumer: number;
  rate: number;
}

/** Feasibility oracle for one proposed support, including forbidden self-supply. */
function match(supply: number[], demand: number[], allowed: boolean[][]): Transfer[] {
  const sink = supply.length + demand.length + 1;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, capacity: number) => {
    const edge = { to, reverse: graph[to].length, capacity };
    graph[from].push(edge);
    graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0 });
    return edge;
  };
  supply.forEach((rate, p) => add(0, p + 1, rate));
  demand.forEach((rate, c) => add(supply.length + c + 1, sink, rate));
  // Exact handoffs first gives sparse incumbents before support branching.
  const transfers = supply
    .flatMap((rate, p) =>
      demand.flatMap((need, c) =>
        allowed[p][c]
          ? [{ p, c, rate: Math.min(rate, need), mismatch: Math.abs(rate - need) }]
          : [],
      ),
    )
    .sort((a, b) => a.mismatch - b.mismatch || b.rate - a.rate || a.p - b.p || a.c - b.c)
    .map(({ p, c, rate }) => ({ p, c, edge: add(p + 1, supply.length + c + 1, rate) }));
  while (true) {
    const parent: ({ from: number; edge: Edge } | undefined)[] = Array(graph.length);
    const queue = [0];
    const seen = new Set([0]);
    for (let head = 0; head < queue.length && !seen.has(sink); head++) {
      const from = queue[head];
      for (const edge of graph[from]) {
        if (edge.capacity <= EPSILON || seen.has(edge.to)) continue;
        seen.add(edge.to);
        parent[edge.to] = { from, edge };
        queue.push(edge.to);
      }
    }
    if (!seen.has(sink)) break;
    let rate = Infinity;
    for (let node = sink; node !== 0;) {
      const step = parent[node]!;
      rate = Math.min(rate, step.edge.capacity);
      node = step.from;
    }
    for (let node = sink; node !== 0;) {
      const step = parent[node]!;
      step.edge.capacity -= rate;
      graph[node][step.edge.reverse].capacity += rate;
      node = step.from;
    }
  }
  return transfers.flatMap(({ p, c, edge }) => {
    const rate = graph[edge.to][edge.reverse].capacity;
    return rate > EPSILON ? [{ producer: p, consumer: c, rate }] : [];
  });
}

export interface FlowSearchResult {
  allocation: ModuleFlowAllocation;
  exploredStates: number;
  optimal: boolean;
}

/** Minimize active connections, preserving maximum internal flow even at a budget stop.
 * Branching removes an incumbent edge; every strictly sparser support omits at least one.
 * Max-flow is only a feasibility oracle, not the placement allocation policy. */
export function searchModuleFlows(
  modules: readonly FactoryModule[],
  resources: readonly ResourceId[],
  maxStates = 64,
): FlowSearchResult {
  const allocation: ModuleFlowAllocation = { connections: [], unmetInputs: [], unusedOutputs: [] };
  let exploredStates = 0;
  let optimal = true;
  for (const resource of [...new Set(resources)].sort()) {
    const producers = modules
      .filter((module) => module.outputs[resource] > EPSILON)
      .toSorted((a, b) => a.id.localeCompare(b.id));
    const consumers = modules
      .filter((module) => module.inputs[resource] > EPSILON)
      .toSorted((a, b) => a.id.localeCompare(b.id));
    const supply = producers.map((module) => module.outputs[resource]);
    const demand = consumers.map((module) => module.inputs[resource]);
    const allowed = producers.map((producer) =>
      consumers.map((consumer) => producer.id !== consumer.id),
    );
    let best = match(supply, demand, allowed);
    const total = best.reduce((sum, edge) => sum + edge.rate, 0);
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const lowerBound = Math.max(
      Math.abs(total - sum(supply)) <= EPSILON ? supply.length : 0,
      Math.abs(total - sum(demand)) <= EPSILON ? demand.length : 0,
    );
    let states = 1;
    const visited = new Set<string>();
    const visit = (edges: Transfer[]) => {
      if (best.length <= lowerBound) return;
      for (const edge of edges.toSorted((a, b) => a.rate - b.rate)) {
        if (states >= Math.max(1, maxStates)) {
          optimal = false;
          return;
        }
        allowed[edge.producer][edge.consumer] = false;
        const key = allowed.map((row) => row.map(Number).join('')).join('/');
        if (!visited.has(key)) {
          visited.add(key);
          states++;
          const candidate = match(supply, demand, allowed);
          if (candidate.reduce((value, flow) => value + flow.rate, 0) >= total - EPSILON) {
            if (candidate.length < best.length) best = candidate;
            visit(candidate);
          }
        }
        allowed[edge.producer][edge.consumer] = true;
        if (best.length <= lowerBound) return;
      }
    };
    visit(best);
    exploredStates += states;
    const usedSupply = supply.map(() => 0);
    const usedDemand = demand.map(() => 0);
    const connections: ModuleConnection[] = best.map(({ producer, consumer, rate }) => {
      usedSupply[producer] += rate;
      usedDemand[consumer] += rate;
      return {
        producerId: producers[producer].id,
        consumerId: consumers[consumer].id,
        resource,
        rate,
      };
    });
    allocation.connections.push(
      ...connections.toSorted(
        (a, b) =>
          a.producerId.localeCompare(b.producerId) || a.consumerId.localeCompare(b.consumerId),
      ),
    );
    supply.forEach((rate, p) => {
      if (rate - usedSupply[p] > EPSILON)
        allocation.unusedOutputs.push({
          moduleId: producers[p].id,
          resource,
          rate: rate - usedSupply[p],
        });
    });
    demand.forEach((rate, c) => {
      if (rate - usedDemand[c] > EPSILON)
        allocation.unmetInputs.push({
          moduleId: consumers[c].id,
          resource,
          rate: rate - usedDemand[c],
        });
    });
  }
  return { allocation, exploredStates, optimal };
}
