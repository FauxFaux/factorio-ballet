import type {
  BeltConnection,
  BeltDirection,
  BeltEntity,
  BeltGraph,
  BeltLane,
  BeltLaneRef,
  InserterTransfer,
  SplitterLine,
  TransportBeltEntity,
  UndergroundBeltEntity,
  UndergroundPair,
} from './belt-model.ts';
import {
  beltDirection,
  isBeltEntity,
  isInserterEntity,
  isSplitterEntity,
  isUndergroundBeltEntity,
} from './belt-model.ts';
import type { Entity, Position } from './decode.ts';

interface SurfacePort {
  entity: BeltEntity;
  position: Position;
  direction: BeltDirection;
  line: SplitterLine;
  splitterSide?: 'input' | 'output';
}

const lanes: BeltLane[] = ['left', 'right'];
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

function portsFor(entity: BeltEntity, splitterSide?: 'input' | 'output'): SurfacePort[] {
  const direction = beltDirection(entity);
  if (!isSplitterEntity(entity)) {
    return [{ entity, position: entity.position, direction, line: 'left' }];
  }

  const lateral = leftVector(direction);
  return splitterLines.map((line) => ({
    entity,
    position: add(entity.position, scale(lateral, line === 'left' ? 0.5 : -0.5)),
    direction,
    line,
    splitterSide,
  }));
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

function findInserterTransfers(entities: Entity[], belts: BeltEntity[]): InserterTransfer[] {
  const occupiedBeltPositions = belts.flatMap((belt) => portsFor(belt, 'output'));
  return entities.filter(isInserterEntity).map((inserter): InserterTransfer => {
    const direction = beltDirection(inserter as TransportBeltEntity);
    const pickup = endpointPosition(inserter, 'pickup_position', direction, 1);
    const drop = endpointPosition(inserter, 'drop_position', direction, -1);
    const source = entityAt(entities, inserter, pickup);
    const target = entityAt(entities, inserter, drop);
    const sourcePort =
      source && isBeltEntity(source)
        ? closestPort(occupiedBeltPositions, pickup, source.entity_number)
        : undefined;
    const targetPort =
      target && isBeltEntity(target)
        ? closestPort(occupiedBeltPositions, drop, target.entity_number)
        : undefined;

    return {
      inserter,
      source,
      target,
      sourceBeltLanes: sourcePort
        ? lanes.map((lane) =>
            laneRef(
              sourcePort.entity.entity_number,
              sourcePort.line,
              lane,
              sourcePort.splitterSide,
            ),
          )
        : [],
      targetBeltLane: targetPort
        ? laneRef(
            targetPort.entity.entity_number,
            targetPort.line,
            inserterDropLane(inserter.position, drop, targetPort),
            targetPort.splitterSide,
          )
        : undefined,
    };
  });
}

function endpointPosition(
  entity: Entity,
  key: 'pickup_position' | 'drop_position',
  direction: BeltDirection,
  defaultSign: number,
): Position {
  const value = entity[key];
  if (Array.isArray(value)) return add(entity.position, { x: value[0], y: value[1] });
  if (value) return add(entity.position, value);
  return add(entity.position, scale(directionVector(direction), defaultSign));
}

function entityAt(entities: Entity[], inserter: Entity, point: Position): Entity | undefined {
  return entities
    .filter((entity) => entity !== inserter)
    .map((entity) => ({ entity, distance: squaredDistance(entity.position, point) }))
    .filter(({ distance }) => distance <= 1)
    .sort((left, right) => left.distance - right.distance)[0]?.entity;
}

function closestPort(
  ports: SurfacePort[],
  point: Position,
  entityNumber: number,
): SurfacePort | undefined {
  return ports
    .filter((port) => port.entity.entity_number === entityNumber)
    .map((port) => ({ port, distance: squaredDistance(port.position, point) }))
    .filter(({ distance }) => distance <= 1)
    .sort((left, right) => left.distance - right.distance)[0]?.port;
}

function inserterDropLane(base: Position, drop: Position, target: SurfacePort): BeltLane {
  const lateral = leftVector(target.direction);
  const dropOffset = dot(subtract(drop, target.position), lateral);
  if (Math.abs(dropOffset) > 0.01) return dropOffset > 0 ? 'left' : 'right';
  const baseOffset = subtract(base, target.position);
  const baseSide = dot(baseOffset, lateral);
  if (baseSide !== 0) return baseSide > 0 ? 'right' : 'left';

  // An arm in line with a belt uses the right lane when dropping with the flow and the left lane
  // when dropping against it.
  return dot(baseOffset, directionVector(target.direction)) < 0 ? 'right' : 'left';
}

function laneRef(
  entityNumber: number,
  line: SplitterLine,
  lane: BeltLane,
  splitterSide?: 'input' | 'output',
): BeltLaneRef {
  return { entityNumber, line, lane, ...(splitterSide ? { splitterSide } : {}) };
}

function directionVector(direction: BeltDirection): Position {
  switch (direction) {
    case 0:
      return { x: 0, y: -1 };
    case 4:
      return { x: 1, y: 0 };
    case 8:
      return { x: 0, y: 1 };
    case 12:
      return { x: -1, y: 0 };
  }
}

function leftVector(direction: BeltDirection): Position {
  const forward = directionVector(direction);
  return { x: forward.y, y: -forward.x };
}

function add(left: Position, right: Position): Position {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Position, right: Position): Position {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(position: Position, factor: number): Position {
  return { x: position.x * factor, y: position.y * factor };
}

function dot(left: Position, right: Position): number {
  return left.x * right.x + left.y * right.y;
}

function cross(left: Position, right: Position): number {
  return left.x * right.y - left.y * right.x;
}

function manhattan(position: Position): number {
  return Math.abs(position.x) + Math.abs(position.y);
}

function squaredDistance(left: Position, right: Position): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function samePosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}
