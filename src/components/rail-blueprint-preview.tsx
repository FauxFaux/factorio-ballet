import './rail-blueprint-preview.css';
import type { Blueprint, Entity } from '../bp/decode.ts';
import { isRailEntity, toRailPiece, type RailPiece } from '../bp/rail.ts';
import { staticData } from '../data/decode.ts';
import type { MachineSize } from '../types.ts';

const brickWidth = 192;
const brickHeight = 120;
const brickPadding = 2;
const signalRadius = 1;

const knownEntitySizes: Record<string, MachineSize> = {
  'big-electric-pole': { width: 2, height: 2 },
  'steel-chest': { width: 1, height: 1 },
  inserter: { width: 1, height: 1 },
  splitter: { width: 2, height: 1 },
  'underground-belt': { width: 1, height: 1 },
};

interface EntityRectangle {
  entity: Entity;
  known: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

function entityRectangle(entity: Entity): EntityRectangle {
  const knownSize =
    staticData.machines[entity.name]?.size ??
    (staticData.belts[entity.name] ? { width: 1, height: 1 } : knownEntitySizes[entity.name]);
  const sourceSize = knownSize ?? { width: 1, height: 1 };
  const rotated = (entity.direction ?? 0) % 8 === 4;
  const width = rotated ? sourceSize.height : sourceSize.width;
  const height = rotated ? sourceSize.width : sourceSize.height;
  return {
    entity,
    known: knownSize !== undefined,
    x: entity.position.x - width / 2,
    y: entity.position.y - height / 2,
    width,
    height,
  };
}

function isSignalEntity(entity: Entity): boolean {
  return entity.name === 'rail-signal' || entity.name === 'rail-chain-signal';
}

function railPoint(piece: RailPiece, end: 0 | 1): { x: number; y: number } {
  const point = piece.ends[end].connectionPoints[0];
  return { x: point.x2 / 2, y: point.y2 / 2 };
}

/** Draw one decoded rail piece between its game connection points. */
export function railPiecePath(piece: RailPiece): string {
  const start = railPoint(piece, 0);
  const end = railPoint(piece, 1);
  if (piece.name.startsWith('curved-rail-')) {
    return `M ${start.x} ${start.y} Q ${piece.position.x} ${piece.position.y} ${end.x} ${end.y}`;
  }
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

function fitBlueprint(
  pieces: RailPiece[],
  rectangles: EntityRectangle[],
  signals: Entity[],
): string | undefined {
  const points = [
    ...pieces.flatMap((piece) => [piece.position, railPoint(piece, 0), railPoint(piece, 1)]),
    ...rectangles.flatMap(({ x, y, width, height }) => [
      { x, y },
      { x: x + width, y: y + height },
    ]),
    ...signals.flatMap(({ position }) => [
      { x: position.x - signalRadius, y: position.y - signalRadius },
      { x: position.x + signalRadius, y: position.y + signalRadius },
    ]),
  ];
  if (points.length === 0) return undefined;
  const minX = Math.min(...points.map(({ x }) => x));
  const maxX = Math.max(...points.map(({ x }) => x));
  const minY = Math.min(...points.map(({ y }) => y));
  const maxY = Math.max(...points.map(({ y }) => y));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const scale = Math.min(
    (brickWidth - brickPadding * 2) / width,
    (brickHeight - brickPadding * 2) / height,
  );
  const x = (brickWidth - width * scale) / 2 - minX * scale;
  const y = (brickHeight - height * scale) / 2 - minY * scale;
  return `translate(${x} ${y}) scale(${scale})`;
}

/** A game-unit rendering of the rail entities in a decoded Factorio blueprint. */
export function RailBlueprintPreview({ blueprint }: { blueprint: Blueprint }) {
  const entities = blueprint.entities ?? [];
  const pieces = entities.filter(isRailEntity).map(toRailPiece);
  const signals = entities.filter(isSignalEntity);
  const rectangles = entities
    .filter((entity) => !isRailEntity(entity) && !isSignalEntity(entity))
    .map(entityRectangle);
  const transform = fitBlueprint(pieces, rectangles, signals);
  const label = blueprint.label ?? 'Untitled blueprint';
  return (
    <figure class="rail-blueprint-preview">
      <figcaption>
        <span>Blueprint rails</span>
      </figcaption>
      <svg
        class="rail-blueprint-preview-entities"
        viewBox={`0 0 ${brickWidth} ${brickHeight}`}
        role="img"
        aria-label={`Rail blueprint entities: ${label}`}
      >
        <title>{label} rail entities</title>
        <desc>
          {pieces.length} rail pieces, {signals.length} signals, and {rectangles.length} other
          entities positioned from the Factorio blueprint.
        </desc>
        <rect
          class="rail-blueprint-preview-floor"
          x="0"
          y="0"
          width={brickWidth}
          height={brickHeight}
        />
        {transform && (
          <g transform={transform}>
            {rectangles.map(({ entity, known, x, y, width, height }) => (
              <rect
                class={`rail-blueprint-preview-entity rail-blueprint-preview-entity-${known ? 'known' : 'unknown'}`}
                key={`entity-${entity.entity_number}`}
                x={x}
                y={y}
                width={width}
                height={height}
                data-blueprint-entity={entity.entity_number}
                data-blueprint-name={entity.name}
              />
            ))}
            {pieces.map((piece) => (
              <path
                class="rail-blueprint-preview-piece-bed"
                key={`bed-${piece.entityNumber}`}
                d={railPiecePath(piece)}
              />
            ))}
            {pieces.map((piece) => (
              <path
                class="rail-blueprint-preview-piece"
                key={piece.entityNumber}
                d={railPiecePath(piece)}
                data-rail-entity={piece.entityNumber}
                data-rail-name={piece.name}
                data-rail-direction={piece.direction}
              />
            ))}
            {signals.map((signal) => (
              <circle
                class={`rail-blueprint-preview-signal rail-blueprint-preview-signal-${signal.name === 'rail-signal' ? 'regular' : 'chain'}`}
                key={`signal-${signal.entity_number}`}
                cx={signal.position.x}
                cy={signal.position.y}
                r={signalRadius}
                data-blueprint-entity={signal.entity_number}
                data-blueprint-name={signal.name}
              />
            ))}
          </g>
        )}
      </svg>
    </figure>
  );
}
