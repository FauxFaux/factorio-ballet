import type { SolidAccessOption } from './access.ts';
import { reachesLane, servesDemand, type AssignedSolidLane, type SolidDemand } from './tracks.ts';

export const RATE_EPSILON = 1e-9;

/** Conservative integer lower bound, allowing floating-point roundoff at exact capacity. */
export function requiredUnits(rate: number, capacity: number): number {
  return rate > 0 ? Math.max(1, Math.ceil(rate / capacity - RATE_EPSILON)) : 0;
}

export interface AllocatedTransfer {
  option: SolidAccessOption;
  lane: AssignedSolidLane;
  rate: number;
}

export interface SolidCapacityResult {
  feasible: boolean;
  transfers: AllocatedTransfer[];
  /** More than one configuration used at a base: branch before emitting this relaxed solution. */
  conflict?: SolidAccessOption[];
}

interface Edge {
  to: number;
  reverse: number;
  residual: number;
}

/** Restricted flow adapter for external-only straight trunks and constant inserter capacities.
 * source -> demand -> assigned lane -> configuration -> base -> sink.
 * A lane belongs to exactly one demand, so merging flow never loses resource identity. Configurations
 * share a base budget; alternative reaches/directions remain a discrete choice in the caller.
 * This is not a general LP replacement for internal production or resource-dependent capacities. */
export function allocateSolidRates(
  demands: SolidDemand[],
  lanes: AssignedSolidLane[],
  options: SolidAccessOption[],
  laneCapacity: number,
): SolidCapacityResult {
  const graph: Edge[][] = [];
  const node = () => (graph.push([]), graph.length - 1);
  const source = node();
  const sink = node();
  const edge = (from: number, to: number, capacity: number) => {
    const forward = { to, reverse: graph[to].length, residual: capacity };
    graph[from].push(forward);
    graph[to].push({ to: from, reverse: graph[from].length - 1, residual: 0 });
    return forward;
  };
  const total = demands.reduce((sum, demand) => sum + demand.rate, 0);
  const demandNodes = new Map(
    demands.map((demand) => {
      const id = node();
      edge(source, id, demand.rate);
      return [demand, id];
    }),
  );
  const laneNodes = lanes.map((lane) => {
    const id = node();
    edge(demandNodes.get(lane.demand)!, id, laneCapacity);
    return id;
  });
  const bases = new Map<string, SolidAccessOption[]>();
  for (const option of options) {
    const key = `${option.base.x},${option.base.y}`;
    const group = bases.get(key) ?? [];
    group.push(option);
    bases.set(key, group);
  }
  const links: { option: SolidAccessOption; lane: AssignedSolidLane; edge: Edge }[] = [];
  for (const group of bases.values()) {
    const base = node();
    edge(base, sink, Math.max(...group.map(({ capacity }) => capacity)));
    for (const option of group) {
      const config = node();
      edge(config, base, option.capacity);
      for (const [index, lane] of lanes.entries()) {
        if (!servesDemand(option, lane.demand) || !reachesLane(option, lane)) continue;
        links.push({ option, lane, edge: edge(laneNodes[index], config, total) });
      }
    }
  }

  // Edmonds–Karp: small bounded graphs, deterministic edge order, fractional rates.
  let flow = 0;
  while (true) {
    const parents: ({ from: number; edge: Edge } | undefined)[] = Array(graph.length);
    const visited = new Set([source]);
    const queue = [source];
    for (let head = 0; head < queue.length && !visited.has(sink); head++) {
      const from = queue[head];
      for (const connection of graph[from]) {
        if (connection.residual <= 0 || visited.has(connection.to)) continue;
        visited.add(connection.to);
        parents[connection.to] = { from, edge: connection };
        queue.push(connection.to);
      }
    }
    if (!visited.has(sink)) break;
    let amount = Infinity;
    for (let at = sink; at !== source; at = parents[at]!.from)
      amount = Math.min(amount, parents[at]!.edge.residual);
    for (let at = sink; at !== source; at = parents[at]!.from) {
      const connection = parents[at]!.edge;
      connection.residual -= amount;
      graph[at][connection.reverse].residual += amount;
    }
    flow += amount;
  }
  if (total - flow > RATE_EPSILON * Math.max(1, total)) return { feasible: false, transfers: [] };
  const transfers = links.flatMap(({ option, lane, edge: connection }) => {
    const rate = graph[connection.to][connection.reverse].residual;
    return rate > 0 ? [{ option, lane, rate }] : [];
  });
  const used = new Set(transfers.map(({ option }) => option));
  const conflict = [...bases.values()].find(
    (group) => group.filter((option) => used.has(option)).length > 1,
  );
  return { feasible: true, transfers, ...(conflict ? { conflict } : {}) };
}
