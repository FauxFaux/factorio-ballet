import type {
  BeltConnection,
  BeltEntity,
  BeltGraph,
  BeltLane,
  SplitterLine,
  UndergroundBeltEntity,
  UndergroundPair,
} from './belt-model.ts';
import {
  beltDirection,
  isBeltEntity,
  isSplitterEntity,
  isUndergroundBeltEntity,
} from './belt-model.ts';
import type { Entity, Position } from './decode.ts';
import {
  add,
  directionVector,
  dot,
  findInserterTransfers,
  laneRef,
  lanes,
  leftVector,
  portsFor,
  scale,
  subtract,
  type SurfacePort,
} from './belt-inserters.ts';

const splitterLines: SplitterLine[] = ['left', 'right'];

/** Build directed lane connectivity, including splitter choices and underground pairs. */
export function buildBeltGraph(entities: Entity[]): BeltGraph {
  const beltEntities = entities.filter(isBeltEntity);
  // Validate directions once, including isolated entities which produce no connections.
  beltEntities.forEach((entity) => beltDirection(entity));

  const sources = beltEntities.flatMap(surfaceOutputs);
  const sourcesByDestination = new Map<string, SurfacePort[]>();
  for (const source of sources) {
    const destination = add(source.position, directionVector(source.direction));
    const matching = sourcesByDestination.get(positionKey(destination)) ?? [];
    matching.push(source);
    sourcesByDestination.set(positionKey(destination), matching);
  }

  const connections: BeltConnection[] = [];
  for (const target of beltEntities.flatMap(surfaceInputs)) {
    const candidates = sourcesByDestination.get(positionKey(target.position)) ?? [];
    connectSurfaceInputs(connections, target, candidates);
  }

  const undergroundPairs = pairUndergroundBelts(beltEntities.filter(isUndergroundBeltEntity));
  for (const pair of undergroundPairs) {
    for (const lane of lanes) {
      connections.push({
        from: laneRef(pair.inputEntityNumber, 'left', lane),
        to: laneRef(pair.outputEntityNumber, 'left', lane),
        kind: 'underground',
      });
    }
  }

  for (const splitter of beltEntities.filter(isSplitterEntity)) {
    for (const inputLine of splitterLines) {
      for (const outputLine of splitterLines) {
        for (const lane of lanes) {
          connections.push({
            from: laneRef(splitter.entity_number, inputLine, lane, 'input'),
            to: laneRef(splitter.entity_number, outputLine, lane, 'output'),
            kind: 'splitter',
          });
        }
      }
    }
  }

  return {
    entities: beltEntities,
    connections,
    undergroundPairs,
    inserterTransfers: findInserterTransfers(entities, beltEntities),
  };
}

function surfaceOutputs(entity: BeltEntity): SurfacePort[] {
  if (isUndergroundBeltEntity(entity) && entity.type === 'input') return [];
  return portsFor(entity, 'output');
}

function surfaceInputs(entity: BeltEntity): SurfacePort[] {
  return portsFor(entity, 'input');
}

function connectSurfaceInputs(
  connections: BeltConnection[],
  target: SurfacePort,
  candidates: SurfacePort[],
) {
  if (isSplitterEntity(target.entity)) {
    const expectedSource = add(target.position, scale(directionVector(target.direction), -1));
    for (const source of candidates.filter((candidate) =>
      samePosition(candidate.position, expectedSource),
    )) {
      connectPreservingLanes(connections, source, target, 'forward');
    }
    return;
  }

  const forward = directionVector(target.direction);
  const behind = add(target.position, scale(forward, -1));
  const primary = candidates.filter((candidate) => samePosition(candidate.position, behind));
  const sides = candidates.filter((candidate) => {
    const delta = subtract(candidate.position, target.position);
    return dot(delta, forward) === 0 && manhattan(delta) === 1;
  });

  if (!isUndergroundBeltEntity(target.entity) || target.entity.type === 'input') {
    for (const source of primary) connectPreservingLanes(connections, source, target, 'forward');
  }

  const ordinaryTurn =
    !isUndergroundBeltEntity(target.entity) && primary.length === 0 && sides.length === 1;
  for (const source of sides) {
    if (ordinaryTurn) connectPreservingLanes(connections, source, target, 'turn');
    else connectSideload(connections, source, target);
  }
}

function connectPreservingLanes(
  connections: BeltConnection[],
  source: SurfacePort,
  target: SurfacePort,
  kind: 'forward' | 'turn',
) {
  for (const lane of lanes) {
    connections.push({
      from: laneRef(source.entity.entity_number, source.line, lane, source.splitterSide),
      to: laneRef(target.entity.entity_number, target.line, lane, target.splitterSide),
      kind,
    });
  }
}

function connectSideload(connections: BeltConnection[], source: SurfacePort, target: SurfacePort) {
  const targetLeft = leftVector(target.direction);
  const sourceSide = dot(subtract(source.position, target.position), targetLeft);
  if (sourceSide === 0) return;
  const targetLane: BeltLane = sourceSide > 0 ? 'left' : 'right';

  let sourceLanes = lanes;
  if (isUndergroundBeltEntity(target.entity)) {
    // Only the source lane which meets the exposed half of an underground endpoint is accepted.
    const exposedDirection = target.entity.type === 'output' ? 1 : -1;
    const targetForward = directionVector(target.direction);
    sourceLanes = lanes.filter((lane) => {
      const offset =
        lane === 'left' ? leftVector(source.direction) : scale(leftVector(source.direction), -1);
      return Math.sign(dot(offset, targetForward)) === exposedDirection;
    });
  }

  for (const sourceLane of sourceLanes) {
    connections.push({
      from: laneRef(source.entity.entity_number, source.line, sourceLane, source.splitterSide),
      to: laneRef(target.entity.entity_number, target.line, targetLane),
      kind: 'sideload',
    });
  }
}

function pairUndergroundBelts(entities: UndergroundBeltEntity[]): UndergroundPair[] {
  const candidates: Array<UndergroundPair & { distance: number }> = [];
  for (const input of entities.filter((entity) => entity.type === 'input')) {
    const direction = beltDirection(input);
    const forward = directionVector(direction);
    for (const output of entities.filter(
      (entity) =>
        entity.type === 'output' &&
        entity.name === input.name &&
        beltDirection(entity) === direction,
    )) {
      const delta = subtract(output.position, input.position);
      const distance = dot(delta, forward);
      if (distance > 0 && cross(delta, forward) === 0) {
        candidates.push({
          inputEntityNumber: input.entity_number,
          outputEntityNumber: output.entity_number,
          span: distance + 1,
          distance,
        });
      }
    }
  }

  candidates.sort((left, right) => left.distance - right.distance);
  const pairedInputs = new Set<number>();
  const pairedOutputs = new Set<number>();
  const pairs: UndergroundPair[] = [];
  for (const candidate of candidates) {
    if (
      pairedInputs.has(candidate.inputEntityNumber) ||
      pairedOutputs.has(candidate.outputEntityNumber)
    ) {
      continue;
    }
    pairedInputs.add(candidate.inputEntityNumber);
    pairedOutputs.add(candidate.outputEntityNumber);
    pairs.push({
      inputEntityNumber: candidate.inputEntityNumber,
      outputEntityNumber: candidate.outputEntityNumber,
      span: candidate.span,
    });
  }
  return pairs;
}

function cross(left: Position, right: Position): number {
  return left.x * right.y - left.y * right.x;
}

function manhattan(position: Position): number {
  return Math.abs(position.x) + Math.abs(position.y);
}

function samePosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}
