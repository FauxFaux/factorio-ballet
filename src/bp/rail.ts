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

export interface StackedRailRow {
  /** Y coordinate of the row's horizontal station rails. */
  y: number;
  minX: number;
  maxX: number;
  straightRails: number;
}

export interface StackedRailLayout {
  /** Station rows, ordered from top to bottom in blueprint coordinates. */
  rows: StackedRailRow[];
  /** Distance between rows. Undefined for a single-row segment. */
  pitch?: number;
}

type EndpointOffsets = readonly [
  readonly [x2: number, y2: number],
  readonly [x2: number, y2: number],
];

/*
 * Offsets are from the blueprint entity position to its two connection nodes. They are expressed
 * in half tiles, so odd coordinates retain the half-tile joins used by curved and diagonal rail.
 * The curve table is established by the closed rail-circle fixture. The straight and half-
 * diagonal entries are additionally exercised by rail-r, the three brick fixtures, and the
 * stacked station fixtures.
 */
const endpointOffsets: Partial<Record<`${RailEntityName}:${RailDirection}`, EndpointOffsets>> = {
  'straight-rail:0': [
    [0, -2],
    [0, 2],
  ],
  'straight-rail:2': [
    [-2, 2],
    [2, -2],
  ],
  'straight-rail:4': [
    [-2, 0],
    [2, 0],
  ],
  'straight-rail:6': [
    [-2, -2],
    [2, 2],
  ],
  'straight-rail:8': [
    [0, -2],
    [0, 2],
  ],
  'straight-rail:10': [
    [-2, 2],
    [2, -2],
  ],
  'straight-rail:12': [
    [-2, 0],
    [2, 0],
  ],
  'straight-rail:14': [
    [-2, -2],
    [2, 2],
  ],
  'half-diagonal-rail:0': [
    [-2, -5],
    [2, 5],
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
  if (!offsets) {
    throw new Error(
      `unsupported rail geometry: ${entity.name} direction ${direction} at (${entity.position.x}, ${entity.position.y})`,
    );
  }

  const x2 = entity.position.x * 2;
  const y2 = entity.position.y * 2;
  if (!Number.isInteger(x2) || !Number.isInteger(y2)) {
    throw new Error(
      `rail ${entity.entity_number} at (${entity.position.x}, ${entity.position.y}) is not positioned on the half-tile grid`,
    );
  }

  const ends = offsets.map(([dx, dy]) => ({
    connectionPoints: [{ x2: x2 + dx, y2: y2 + dy }],
  })) as [RailEnd, RailEnd];

  // A half-diagonal end can accept either adjacent curve sub-type. Their blueprint anchors differ
  // by one tile, so both keys describe one logical end rather than two ends.
  if (entity.name === 'half-diagonal-rail' && direction === 4) {
    ends[0].connectionPoints.push({ x2: x2 - 5, y2: y2 + 2 });
    ends[1].connectionPoints.push({ x2: x2 + 3, y2: y2 - 2 });
  } else if (entity.name === 'half-diagonal-rail' && direction === 6) {
    ends[0].connectionPoints.push({ x2: x2 - 5, y2: y2 - 2 });
    ends[1].connectionPoints.push({ x2: x2 + 5, y2: y2 + 2 });
  } else if (entity.name === 'half-diagonal-rail' && direction === 0) {
    // Direction 0 appears in both halves of the stacked layout's junctions. As with directions 4
    // and 6, the two curve sub-types serialize with different anchors for the same logical ends.
    ends[0].connectionPoints.push({ x2: x2 - 5, y2: y2 + 2 });
    ends[1].connectionPoints.push({ x2: x2 + 2, y2: y2 + 3 });
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

/**
 * Find the repeated horizontal station rows in a stacked-rail blueprint.
 *
 * A row is identified by its run of east-west straight rails and the four direction-12 signals
 * placed 1.5 tiles below it. This excludes the much longer horizontal rail-grid edge and avoids
 * depending on entity numbers or absolute fixture coordinates.
 */
export function findStackedRailLayout(entities: Entity[]): StackedRailLayout {
  const horizontalByY = new Map<number, RailEntity[]>();
  for (const entity of entities.filter(isRailEntity)) {
    if (entity.name !== 'straight-rail' || railDirection(entity) !== 4) continue;
    const row = horizontalByY.get(entity.position.y) ?? [];
    row.push(entity);
    horizontalByY.set(entity.position.y, row);
  }

  const rows = [...horizontalByY]
    .filter(([y, rails]) => {
      const minX = Math.min(...rails.map(({ position }) => position.x));
      const maxX = Math.max(...rails.map(({ position }) => position.x));
      return (
        entities.filter(
          (entity) =>
            entity.name === 'rail-signal' &&
            entity.direction === 12 &&
            entity.position.y === y + 1.5 &&
            entity.position.x >= minX - 1 &&
            entity.position.x <= maxX + 1,
        ).length >= 4
      );
    })
    .map(([y, rails]): StackedRailRow => {
      const xs = rails.map(({ position }) => position.x);
      return {
        y,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        straightRails: rails.length,
      };
    })
    .sort((a, b) => a.y - b.y);

  if (rows.length === 0) throw new Error('blueprint has no stacked rail station rows');
  const pitches = new Set(rows.slice(1).map((row, index) => row.y - rows[index].y));
  if (pitches.size > 1) {
    throw new Error(`stacked rail rows do not have a uniform pitch: ${[...pitches].join(', ')}`);
  }

  return { rows, ...(pitches.size === 1 ? { pitch: [...pitches][0] } : {}) };
}

function railDirection(entity: RailEntity): RailDirection {
  return entity.direction ?? 0;
}
