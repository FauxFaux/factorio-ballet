import { beltLaneKey, isSplitterEntity } from './belt-model.ts';
import type {
  BeltConnection,
  BeltEntity,
  BeltGraph,
  BeltLaneRef,
  BeltTrace,
} from './belt-model.ts';

/**
 * Follow one lane until it reaches a splitter or can no longer be followed unambiguously.
 * The starting lane is included in the result.
 */
export function traceBeltToSplitter(graph: BeltGraph, start: BeltLaneRef): BeltTrace {
  const entityByNumber = new Map(graph.entities.map((entity) => [entity.entity_number, entity]));
  const outgoing = connectionsBySource(graph.connections);
  const trace: BeltTrace = { lanes: [start], connections: [], stop: 'end' };
  const visited = new Set([beltLaneKey(start)]);
  let current = start;

  while (true) {
    if (isSplitterEntityNumber(entityByNumber, current.entityNumber)) {
      trace.stop = 'splitter';
      return trace;
    }

    const next = outgoing.get(beltLaneKey(current)) ?? [];
    if (next.length === 0) return trace;
    if (next.length > 1) {
      trace.stop = 'branch';
      return trace;
    }

    const connection = next[0];
    trace.connections.push(connection);
    trace.lanes.push(connection.to);
    current = connection.to;
    const key = beltLaneKey(current);
    if (visited.has(key)) {
      trace.stop = 'cycle';
      return trace;
    }
    visited.add(key);
  }
}

/** Enumerate all possible continuations, stopping each result at an end or repeated lane. */
export function traceBeltPaths(graph: BeltGraph, start: BeltLaneRef): BeltTrace[] {
  const outgoing = connectionsBySource(graph.connections);
  const results: BeltTrace[] = [];

  const visit = (
    current: BeltLaneRef,
    pathLanes: BeltLaneRef[],
    pathConnections: BeltConnection[],
    visited: Set<string>,
  ) => {
    const next = outgoing.get(beltLaneKey(current)) ?? [];
    if (next.length === 0) {
      results.push({ lanes: pathLanes, connections: pathConnections, stop: 'end' });
      return;
    }

    for (const connection of next) {
      const key = beltLaneKey(connection.to);
      if (visited.has(key)) {
        results.push({
          lanes: [...pathLanes, connection.to],
          connections: [...pathConnections, connection],
          stop: 'cycle',
        });
        continue;
      }
      visit(
        connection.to,
        [...pathLanes, connection.to],
        [...pathConnections, connection],
        new Set([...visited, key]),
      );
    }
  };

  visit(start, [start], [], new Set([beltLaneKey(start)]));
  return results;
}

function connectionsBySource(connections: BeltConnection[]): Map<string, BeltConnection[]> {
  const result = new Map<string, BeltConnection[]>();
  for (const connection of connections) {
    const key = beltLaneKey(connection.from);
    const matching = result.get(key) ?? [];
    matching.push(connection);
    result.set(key, matching);
  }
  return result;
}

function isSplitterEntityNumber(entities: Map<number, BeltEntity>, entityNumber: number): boolean {
  const entity = entities.get(entityNumber);
  return entity !== undefined && isSplitterEntity(entity);
}
