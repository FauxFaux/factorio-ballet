import type {
  BeltDirection,
  BeltEntity,
  BeltLane,
  BeltLaneRef,
  InserterTransfer,
  SplitterLine,
  TransportBeltEntity,
} from './belt-model.ts';
import { beltDirection, isBeltEntity, isInserterEntity, isSplitterEntity } from './belt-model.ts';
import type { Entity, Position } from './decode.ts';

export interface SurfacePort {
  entity: BeltEntity;
  position: Position;
  direction: BeltDirection;
  line: SplitterLine;
  splitterSide?: 'input' | 'output';
}

export const lanes: BeltLane[] = ['left', 'right'];
const splitterLines: SplitterLine[] = ['left', 'right'];

export function portsFor(entity: BeltEntity, splitterSide?: 'input' | 'output'): SurfacePort[] {
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

/** Find the belt lanes connected to each inserter's pickup and drop endpoints. */
export function findInserterTransfers(entities: Entity[], belts: BeltEntity[]): InserterTransfer[] {
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

export function laneRef(
  entityNumber: number,
  line: SplitterLine,
  lane: BeltLane,
  splitterSide?: 'input' | 'output',
): BeltLaneRef {
  return { entityNumber, line, lane, ...(splitterSide ? { splitterSide } : {}) };
}

export function directionVector(direction: BeltDirection): Position {
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

export function leftVector(direction: BeltDirection): Position {
  const forward = directionVector(direction);
  return { x: forward.y, y: -forward.x };
}

export function add(left: Position, right: Position): Position {
  return { x: left.x + right.x, y: left.y + right.y };
}

export function subtract(left: Position, right: Position): Position {
  return { x: left.x - right.x, y: left.y - right.y };
}

export function scale(position: Position, factor: number): Position {
  return { x: position.x * factor, y: position.y * factor };
}

export function dot(left: Position, right: Position): number {
  return left.x * right.x + left.y * right.y;
}

export function squaredDistance(left: Position, right: Position): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}
