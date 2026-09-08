import type { Entity } from './decode.ts';

export type BeltDirection = 0 | 4 | 8 | 12;
export type BeltLane = 'left' | 'right';
export type SplitterLine = 'left' | 'right';

export interface TransportBeltEntity extends Entity {
  direction?: BeltDirection;
}

export interface UndergroundBeltEntity extends TransportBeltEntity {
  type: 'input' | 'output';
}

export interface SplitterEntity extends TransportBeltEntity {
  input_priority?: SplitterLine;
  output_priority?: SplitterLine;
  filter?: string;
}

export type BeltEntity = TransportBeltEntity | UndergroundBeltEntity | SplitterEntity;

/** One of the two item lanes on one belt line. Splitters have two parallel lines. */
export interface BeltLaneRef {
  entityNumber: number;
  line: SplitterLine;
  lane: BeltLane;
  /** Splitter inputs and outputs are distinct; omitted for one-tile belt entities. */
  splitterSide?: 'input' | 'output';
}

export type BeltConnectionKind = 'forward' | 'turn' | 'sideload' | 'underground' | 'splitter';

export interface BeltConnection {
  from: BeltLaneRef;
  to: BeltLaneRef;
  kind: BeltConnectionKind;
}

export interface UndergroundPair {
  inputEntityNumber: number;
  outputEntityNumber: number;
  /** Number of tiles from the input through the output, including both endpoint tiles. */
  span: number;
}

export interface InserterTransfer {
  inserter: Entity;
  source?: Entity;
  target?: Entity;
  /** Inserters may pick from either lane of the belt line under their pickup point. */
  sourceBeltLanes: BeltLaneRef[];
  /** Inserters drop on one lane, normally the lane farthest from their base. */
  targetBeltLane?: BeltLaneRef;
}

export interface BeltGraph {
  entities: BeltEntity[];
  connections: BeltConnection[];
  undergroundPairs: UndergroundPair[];
  inserterTransfers: InserterTransfer[];
}

export type BeltTraceStop = 'splitter' | 'end' | 'branch' | 'cycle';

export interface BeltTrace {
  lanes: BeltLaneRef[];
  connections: BeltConnection[];
  stop: BeltTraceStop;
}

export function isTransportBeltEntity(entity: Entity): entity is TransportBeltEntity {
  return entity.name === 'transport-belt' || entity.name.endsWith('-transport-belt');
}

export function isUndergroundBeltEntity(entity: Entity): entity is UndergroundBeltEntity {
  return (
    (entity.name === 'underground-belt' || entity.name.endsWith('-underground-belt')) &&
    (entity.type === 'input' || entity.type === 'output')
  );
}

export function isSplitterEntity(entity: Entity): entity is SplitterEntity {
  return entity.name === 'splitter' || entity.name.endsWith('-splitter');
}

export function isBeltEntity(entity: Entity): entity is BeltEntity {
  return (
    isTransportBeltEntity(entity) || isUndergroundBeltEntity(entity) || isSplitterEntity(entity)
  );
}

export function isInserterEntity(entity: Entity): boolean {
  return entity.name === 'inserter' || entity.name.endsWith('-inserter');
}

export function beltDirection(entity: TransportBeltEntity): BeltDirection {
  const direction = entity.direction ?? 0;
  if (direction !== 0 && direction !== 4 && direction !== 8 && direction !== 12) {
    throw new Error(`unsupported belt direction ${direction} on entity ${entity.entity_number}`);
  }
  return direction;
}
