import './rail-blueprint-preview.css';
import type { Blueprint, Entity, Position } from '../bp/decode.ts';
import { isRailEntity, toRailPiece, type RailPiece } from '../bp/rail.ts';
import { useDataset } from '../dataset/context.tsx';
import type { StaticData } from '../types.ts';

const brickWidth = 192;
const brickHeight = 120;
const layoutHeight = 128;
const brickPadding = 2;
const signalRadius = 1;

interface EntityRectangle {
  entity: Entity;
  known: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

function entityRectangle(entity: Entity, data: StaticData): EntityRectangle {
  const known = data.entities[entity.name];
  const sourceSize = known?.size ?? { width: 1, height: 1 };
  const rotated = (entity.direction ?? 0) % 4 === 2;
  const width = rotated ? sourceSize.height : sourceSize.width;
  const height = rotated ? sourceSize.width : sourceSize.height;
  return {
    entity,
    known: known !== undefined,
    x: entity.position.x - width / 2,
    y: entity.position.y - height / 2,
    width,
    height,
    color:
      known && `rgb(${known.chartColor.map((channel) => Math.round(channel * 255)).join(' ')})`,
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

function blueprintBounds(
  pieces: RailPiece[],
  rectangles: EntityRectangle[],
  signals: Entity[],
): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const includePoint = (x: number, y: number) => {
    count++;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  for (const piece of pieces) {
    includePoint(piece.position.x, piece.position.y);
    for (const end of [0, 1] as const) {
      const point = railPoint(piece, end);
      includePoint(point.x, point.y);
    }
  }
  for (const { x, y, width, height } of rectangles) {
    includePoint(x, y);
    includePoint(x + width, y + height);
  }
  for (const { position } of signals) {
    includePoint(position.x - signalRadius, position.y - signalRadius);
    includePoint(position.x + signalRadius, position.y + signalRadius);
  }

  return count === 0 ? undefined : { minX, maxX, minY, maxY };
}

/** Scale a blueprint to the standalone preview canvas. */
export function fitBlueprint(
  pieces: RailPiece[],
  rectangles: EntityRectangle[],
  signals: Entity[],
): string | undefined {
  const bounds = blueprintBounds(pieces, rectangles, signals);
  if (!bounds) return undefined;
  const { minX, maxX, minY, maxY } = bounds;
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

/** Centre a blueprint at game-unit scale in the fixed 192 by 128 cell-layout grid. */
export function centreBlueprint(
  pieces: RailPiece[],
  rectangles: EntityRectangle[],
  signals: Entity[],
): string | undefined {
  const offset = centreBlueprintOffset(pieces, rectangles, signals);
  return offset && `translate(${offset.x} ${offset.y})`;
}

/** Offset an unscaled blueprint into the fixed 192 by 128 cell-layout grid. */
function centreBlueprintOffset(
  pieces: RailPiece[],
  rectangles: EntityRectangle[],
  signals: Entity[],
): Position | undefined {
  const bounds = blueprintBounds(pieces, rectangles, signals);
  if (!bounds) return undefined;
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  return {
    x: (brickWidth - width) / 2 - bounds.minX,
    y: (layoutHeight - height) / 2 - bounds.minY,
  };
}

/** The translation used by an embedded rail preview, exposed for aligned layout overlays. */
export function embeddedBlueprintOffset(
  blueprint: Blueprint,
  data: StaticData,
): Position | undefined {
  const entities = blueprint.entities ?? [];
  return centreBlueprintOffset(
    entities.filter(isRailEntity).map(toRailPiece),
    entities
      .filter((entity) => !isRailEntity(entity) && !isSignalEntity(entity))
      .map((entity) => entityRectangle(entity, data)),
    entities.filter(isSignalEntity),
  );
}

/** A game-unit rendering of the rail entities in a decoded Factorio blueprint. */
export function RailBlueprintPreview({
  blueprint,
  embedded = false,
}: {
  blueprint: Blueprint;
  /** Omits the standalone figure chrome so the rendering can sit over another tile surface. */
  embedded?: boolean;
}) {
  const { data } = useDataset();
  const entities = blueprint.entities ?? [];
  const pieces = entities.filter(isRailEntity).map(toRailPiece);
  const signals = entities.filter(isSignalEntity);
  const rectangles = entities
    .filter((entity) => !isRailEntity(entity) && !isSignalEntity(entity))
    .map((entity) => entityRectangle(entity, data));
  const transform = embedded
    ? centreBlueprint(pieces, rectangles, signals)
    : fitBlueprint(pieces, rectangles, signals);
  const label = blueprint.label ?? 'Untitled blueprint';
  const drawing = (
    <svg
      class={
        embedded
          ? 'rail-blueprint-preview-entities cell-layout-blueprint-entities'
          : 'rail-blueprint-preview-entities'
      }
      viewBox={`0 0 ${brickWidth} ${embedded ? layoutHeight : brickHeight}`}
      role="img"
      aria-label={`Rail blueprint entities: ${label}`}
    >
      <title>{label} rail entities</title>
      <desc>
        {pieces.length} rail pieces, {signals.length} signals, and {rectangles.length} other
        entities positioned from the Factorio blueprint.
      </desc>
      {!embedded ? (
        <rect
          class="rail-blueprint-preview-floor"
          x="0"
          y="0"
          width={brickWidth}
          height={brickHeight}
        />
      ) : null}
      {transform && (
        <g transform={transform}>
          {rectangles.map(({ entity, known, x, y, width, height, color }) => (
            <rect
              class={`rail-blueprint-preview-entity rail-blueprint-preview-entity-${known ? 'known' : 'unknown'} ${width === 1 && height === 1 ? 'rail-blueprint-preview-entity-single-cell' : ''}`}
              key={`entity-${entity.entity_number}`}
              x={x}
              y={y}
              width={width}
              height={height}
              style={color ? { fill: color } : undefined}
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
  );

  if (embedded) return drawing;
  return (
    <figure class="rail-blueprint-preview">
      <figcaption>
        <span>Blueprint rails</span>
      </figcaption>
      {drawing}
    </figure>
  );
}
