import { buildBeltGraph } from '../../bp/belt.ts';
import { beltLaneKey } from '../../bp/belt-model.ts';
import type { Entity } from '../../bp/decode.ts';
import type { DesignDirection, DesignPosition } from '../design.ts';
import type { TileDesignCandidate, TileValidationInput } from './types.ts';

type ReportIssue = (code: string, message: string, index?: number, resource?: string) => void;

const vectors: Record<DesignDirection, DesignPosition> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};
const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];

export function validateBelts(
  input: TileValidationInput,
  candidate: TileDesignCandidate,
  issue: ReportIssue,
) {
  const { entities } = candidate.column;
  const graph = buildBeltGraph(
    entities.flatMap((entity, index): Entity[] => {
      if (
        entity.kind !== 'belt' &&
        entity.kind !== 'underground-belt' &&
        entity.kind !== 'inserter'
      )
        return [];
      const direction = (directions.indexOf(entity.direction) * 4) as 0 | 4 | 8 | 12;
      const base = { entity_number: index, position: entity.position, direction };
      if (entity.kind === 'inserter') {
        const offset = vectors[entity.direction];
        const reach = entity.reach ?? 1;
        return [
          {
            ...base,
            name: 'inserter',
            pickup_position: [-offset.x * reach, -offset.y * reach],
            drop_position: [offset.x * reach, offset.y * reach],
          },
        ];
      }
      return [
        {
          ...base,
          name: entity.kind === 'belt' ? 'transport-belt' : 'underground-belt',
          ...(entity.kind === 'underground-belt' ? { type: entity.end } : {}),
        },
      ];
    }),
  );
  if (entities.some((entity) => entity.kind === 'splitter'))
    issue('unsupported-entity', 'Splitter validation is not yet supported.');
  for (const [index, entity] of entities.entries()) {
    if (entity.kind !== 'belt' && entity.kind !== 'underground-belt') continue;
    const track = candidate.boundary.find(
      (track) => track.kind === 'belt' && track.x === entity.position.x,
    );
    if (
      !track ||
      entity.direction !== track.direction ||
      (entity.direction !== 'north' && entity.direction !== 'south')
    )
      issue(
        'unsupported-belt-route',
        'Only straight vertical trunks with in-tile tunnels can be certified.',
        index,
      );
  }
  const paired = new Set(
    graph.undergroundPairs.flatMap(({ inputEntityNumber, outputEntityNumber }) => [
      inputEntityNumber,
      outputEntityNumber,
    ]),
  );
  entities.forEach((entity, index) => {
    if (entity.kind === 'underground-belt' && !paired.has(index))
      issue('underground-pair', `Underground belt ${index} has no partner.`, index);
  });
  // Local non-overlapping pairs leave no endpoint looking for a partner in another copy.
  // This also proves finite-run connectivity without adding end caps.
  for (const pair of graph.undergroundPairs) {
    const a = entities[pair.inputEntityNumber].position;
    const b = entities[pair.outputEntityNumber].position;
    for (const [index, entity] of entities.entries()) {
      if (
        (entity.kind === 'belt' || entity.kind === 'underground-belt') &&
        entity.position.x === a.x &&
        entity.position.y > Math.min(a.y, b.y) &&
        entity.position.y < Math.max(a.y, b.y)
      )
        issue(
          'underground-conflict',
          'A trunk has exposed belt geometry inside its tunnel.',
          index,
        );
    }
  }
  for (const pair of graph.undergroundPairs)
    if (pair.span - 2 > input.transport.undergroundBeltReach)
      issue(
        'underground-reach',
        'Underground belt exceeds the declared reach.',
        pair.inputEntityNumber,
      );

  const lanes = new Map<string, string>();
  for (const lane of candidate.lanes) {
    const entity = entities[lane.entityIndex];
    if (entity?.kind !== 'belt' && entity?.kind !== 'underground-belt') {
      issue('lane-entity', 'Lane assignment refers to a non-belt.', lane.entityIndex);
      continue;
    }
    const id = `${lane.entityIndex}:${lane.lane}`;
    if (lanes.has(id) && lanes.get(id) !== lane.resource)
      issue('mixed-lane', 'One lane has conflicting resources.', lane.entityIndex, lane.resource);
    lanes.set(id, lane.resource);
  }
  for (const { from, to } of graph.connections) {
    const source = lanes.get(`${from.entityNumber}:${from.lane}`);
    const target = lanes.get(`${to.entityNumber}:${to.lane}`);
    if (source && target && source !== target)
      issue('lane-continuity', `Connected lanes carry ${source} and ${target}.`, to.entityNumber);
  }
  const laneEdges = new Map<string, string[]>();
  for (const { from, to } of graph.connections) {
    const outgoing = laneEdges.get(beltLaneKey(from)) ?? [];
    outgoing.push(beltLaneKey(to));
    laneEdges.set(beltLaneKey(from), outgoing);
  }
  for (const track of candidate.boundary) {
    if (track.kind !== 'belt') continue;
    const bottom = entities.findIndex(
      (entity) =>
        (entity.kind === 'belt' || entity.kind === 'underground-belt') &&
        entity.position.x === track.x &&
        entity.position.y === candidate.pitch - 1,
    );
    const top = entities.findIndex(
      (entity) =>
        (entity.kind === 'belt' || entity.kind === 'underground-belt') &&
        entity.position.x === track.x &&
        entity.position.y === 0,
    );
    if (bottom < 0 || top < 0) continue;
    for (const side of ['left', 'right'] as const) {
      if (!track.lanes?.[side]) continue;
      const start = `${track.direction === 'north' ? bottom : top}:left:${side}:`;
      const destination = `${track.direction === 'north' ? top : bottom}:left:${side}:`;
      const pending = [start];
      const visited = new Set<string>();
      while (pending.length) {
        const current = pending.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const next of laneEdges.get(current) ?? []) pending.push(next);
      }
      if (!visited.has(destination))
        issue('boundary-continuity', `Belt lane ${side} at x=${track.x} does not cross the tile.`);
    }
  }
  return { graph, lanes };
}
