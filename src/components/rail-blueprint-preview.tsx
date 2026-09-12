import './rail-blueprint-preview.css';
import type { Blueprint } from '../bp/decode.ts';
import { isRailEntity, toRailPiece, type RailPiece } from '../bp/rail.ts';

const brickWidth = 192;
const brickHeight = 120;
const brickPadding = 2;

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

function fitRailPieces(pieces: RailPiece[]): string | undefined {
  if (pieces.length === 0) return undefined;
  const points = pieces.flatMap((piece) => [
    piece.position,
    railPoint(piece, 0),
    railPoint(piece, 1),
  ]);
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
  const pieces = (blueprint.entities ?? []).filter(isRailEntity).map(toRailPiece);
  const transform = fitRailPieces(pieces);
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
        <desc>{pieces.length} rail pieces positioned from the Factorio blueprint.</desc>
        <rect
          class="rail-blueprint-preview-floor"
          x="0"
          y="0"
          width={brickWidth}
          height={brickHeight}
        />
        {transform && (
          <g transform={transform}>
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
          </g>
        )}
      </svg>
    </figure>
  );
}
