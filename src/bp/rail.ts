import type { Entity, Position } from './decode.ts';

export const railEntityNames = [
  'straight-rail',
  'half-diagonal-rail',
  'curved-rail-a',
  'curved-rail-b',
] as const;

export type RailEntityName = (typeof railEntityNames)[number];
export type RailDirection = 0 | 2 | 4 | 6 | 8 | 10 | 12 | 14;

export interface RailEntity extends Entity {
  name: RailEntityName;
  direction?: RailDirection;
}

/** A connection key in half-tile coordinates. */
export interface RailNodePosition {
  x2: number;
  y2: number;
}

export interface RailEnd {
  /** Equivalent keys arising from Factorio's asymmetric entity anchors. */
  connectionPoints: RailNodePosition[];
}

export interface RailPiece {
  entityNumber: number;
  name: RailEntityName;
  position: Position;
  direction: RailDirection;
  ends: readonly [RailEnd, RailEnd];
}

export interface RailNode {
  connectionPoints: RailNodePosition[];
  /** All pieces meeting here; three or more indicate a switch or overlapping junction. */
  entityNumbers: number[];
}

export interface RailGraph {
  pieces: RailPiece[];
  nodes: RailNode[];
}

export interface RailAlignment {
  /** Add this offset to the candidate blueprint to place it in the reference coordinates. */
  offset: Position;
  matchingRails: number;
}

type EndpointOffsets = readonly [
  readonly [x2: number, y2: number],
  readonly [x2: number, y2: number],
];

/*
 * Offsets are from the blueprint entity position to its two connection nodes. They are expressed
 * in half tiles, so odd coordinates retain the half-tile joins used by curved and diagonal rail.
 * The curve table is established by the closed rail-circle fixture. The straight and half-
 * diagonal entries are additionally exercised by rail-r and the three brick fixtures.
 */
const endpointOffsets: Partial<Record<`${RailEntityName}:${RailDirection}`, EndpointOffsets>> = {
  'straight-rail:0': [
    [0, -2],
    [0, 2],
  ],
  'straight-rail:4': [
    [-2, 0],
    [2, 0],
  ],
  'half-diagonal-rail:4': [
    [-3, 2],
    [5, -2],
  ],
  'half-diagonal-rail:6': [
    [-3, -2],
    [3, 2],
  ],
  'curved-rail-a:0': [
    [0, 4],
    [-2, -5],
  ],
  'curved-rail-a:2': [
    [2, -5],
    [0, 4],
  ],
  'curved-rail-a:4': [
    [-4, 0],
    [5, -2],
  ],
  'curved-rail-a:6': [
    [5, 2],
    [-4, 0],
  ],
  'curved-rail-a:8': [
    [0, -4],
    [2, 5],
  ],
  'curved-rail-a:10': [
    [-2, 5],
    [0, -4],
  ],
  'curved-rail-a:12': [
    [4, 0],
    [-5, 2],
  ],
  'curved-rail-a:14': [
    [-5, -2],
    [4, 0],
  ],
  'curved-rail-b:0': [
    [2, 5],
    [-4, -4],
  ],
  'curved-rail-b:2': [
    [4, -4],
    [-2, 5],
  ],
  'curved-rail-b:4': [
    [-5, 2],
    [4, -4],
  ],
  'curved-rail-b:6': [
    [4, 4],
    [-5, -2],
  ],
  'curved-rail-b:8': [
    [-2, -5],
    [4, 4],
  ],
  'curved-rail-b:10': [
    [-4, 4],
    [2, -5],
  ],
  'curved-rail-b:12': [
    [5, -2],
    [-4, 4],
  ],
  'curved-rail-b:14': [
    [-4, -4],
    [5, 2],
  ],
};

export function isRailEntity(entity: Entity): entity is RailEntity {
  return railEntityNames.some((name) => entity.name === name);
}

export function toRailPiece(entity: RailEntity): RailPiece {
  const direction = entity.direction ?? 0;
  const offsets = endpointOffsets[`${entity.name}:${direction}`];
  if (!offsets) throw new Error(`unsupported rail geometry: ${entity.name} direction ${direction}`);

  const x2 = entity.position.x * 2;
  const y2 = entity.position.y * 2;
  if (!Number.isInteger(x2) || !Number.isInteger(y2)) {
    throw new Error(`rail ${entity.entity_number} is not positioned on the half-tile grid`);
  }

  const ends = offsets.map(([dx, dy]) => ({
    connectionPoints: [{ x2: x2 + dx, y2: y2 + dy }],
  })) as [RailEnd, RailEnd];

  // A half-diagonal end can accept either adjacent curve sub-type. Their blueprint anchors differ
  // by one tile, so both keys describe one logical end rather than two ends.
  if (entity.name === 'half-diagonal-rail' && direction === 4) {
    ends[1].connectionPoints.push({ x2: x2 + 3, y2: y2 - 2 });
  } else if (entity.name === 'half-diagonal-rail' && direction === 6) {
    ends[1].connectionPoints.push({ x2: x2 + 5, y2: y2 + 2 });
  }

  return {
    entityNumber: entity.entity_number,
    name: entity.name,
    position: entity.position,
    direction,
    ends,
  };
}

export function buildRailGraph(entities: Entity[]): RailGraph {
  const pieces = entities.filter(isRailEntity).map(toRailPiece);
  const ends = pieces.flatMap((piece) =>
    piece.ends.map((end) => ({ entityNumber: piece.entityNumber, ...end })),
  );
  const parents = ends.map((_, index) => index);
  const endByConnectionPoint = new Map<string, number>();

  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };

  const join = (left: number, right: number) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  ends.forEach((end, index) => {
    for (const point of end.connectionPoints) {
      const key = `${point.x2},${point.y2}`;
      const previous = endByConnectionPoint.get(key);
      if (previous === undefined) endByConnectionPoint.set(key, index);
      else join(index, previous);
    }
  });

  const nodeGroups = new Map<number, typeof ends>();
  ends.forEach((end, index) => {
    const endRoot = root(index);
    const group = nodeGroups.get(endRoot) ?? [];
    group.push(end);
    nodeGroups.set(endRoot, group);
  });

  const nodes = [...nodeGroups.values()].map((group): RailNode => {
    const points = new Map<string, RailNodePosition>();
    for (const end of group) {
      for (const point of end.connectionPoints) points.set(`${point.x2},${point.y2}`, point);
    }
    return {
      connectionPoints: [...points.values()],
      entityNumbers: [...new Set(group.map((end) => end.entityNumber))],
    };
  });

  return { pieces, nodes };
}

/** Find the translation with the largest exact overlap of rail kind and direction. */
export function findRailAlignment(reference: Entity[], candidate: Entity[]): RailAlignment {
  const referenceRails = reference.filter(isRailEntity);
  const candidateRails = candidate.filter(isRailEntity);
  if (referenceRails.length === 0 || candidateRails.length === 0) {
    throw new Error('cannot align blueprints without rails');
  }

  const scores = new Map<string, RailAlignment>();
  for (const expected of referenceRails) {
    for (const actual of candidateRails) {
      if (expected.name !== actual.name || railDirection(expected) !== railDirection(actual))
        continue;

      const offset = {
        x: expected.position.x - actual.position.x,
        y: expected.position.y - actual.position.y,
      };
      const key = `${offset.x},${offset.y}`;
      const alignment = scores.get(key) ?? { offset, matchingRails: 0 };
      alignment.matchingRails += 1;
      scores.set(key, alignment);
    }
  }

  const best = [...scores.values()].sort(
    (a, b) =>
      b.matchingRails - a.matchingRails || a.offset.y - b.offset.y || a.offset.x - b.offset.x,
  )[0];
  if (!best) throw new Error('blueprints have no compatible rail pieces');
  return best;
}

function railDirection(entity: RailEntity): RailDirection {
  return entity.direction ?? 0;
}
