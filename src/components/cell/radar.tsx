import './radar.css';
import { resourceName } from '../../data/index.ts';
import type { ResourceId } from '../../types.ts';

/**
 * RADAR's rail view adapted to one cell, which is one brick for now. Its 192-by-128 coordinates
 * are deliberately schematic; `docs/blueprints/RAIL.md` is the source for the future blueprint
 * geometry. The grid and every station siding are deliberately one SVG path, as in RADAR.
 */
export function CellRadar({
  title,
  inputs,
  outputs,
}: {
  title: string;
  inputs: ResourceId[];
  outputs: ResourceId[];
}) {
  return (
    <figure class="cell-radar">
      <figcaption>
        <span>Rail brick</span>
        <span class="cell-radar-caption">{title}</span>
      </figcaption>
      <svg
        viewBox="0 0 192 128"
        role="img"
        aria-label={`Rail brick for ${title}: ${inputs.length} input and ${outputs.length} output stations`}
      >
        <title>Rail brick for {title}</title>
        <desc>
          A cell-sized rail brick. Each input has a station on the left and each output has a
          station on the right.
        </desc>
        <rect class="cell-radar-floor" x="0" y="0" width="192" height="128" />
        <RailBorder />
        <path class="cell-radar-path" d={railPath(inputs.length, outputs.length)} />
        <StationStops side="in" resources={inputs} />
        <StationStops side="out" resources={outputs} />
      </svg>
    </figure>
  );
}

/** The four straight outer tracks from RADAR's grid. The remaining rails are in `railPath`. */
function RailBorder() {
  return (
    <g class="cell-radar-border">
      <rect x="3" y="4" width="2" height="120" />
      <rect x="187" y="4" width="2" height="120" />
      <rect x="0" y="4" width="192" height="2" />
      <rect x="0" y="122" width="192" height="2" />
    </g>
  );
}

/**
 * The original RADAR station allocator's geometry. Input sidings peel right from the left edge;
 * output sidings are its mirror. Keeping every segment in one path makes the rail shape a single
 * renderable object when we later swap its approximate coordinates for blueprint-derived ones.
 */
function railPath(inputCount: number, outputCount: number): string {
  const cubic = (
    [startControlX, startControlY]: [number, number],
    [endControlX, endControlY]: [number, number],
    [endX, endY]: [number, number],
  ) =>
    `c ${startControlX} ${startControlY}, ${endControlX + endX} ${endControlY + endY}, ${endX} ${endY}`;

  const rails = [
    'M 4 13 a 8 8 0 0 1 8 -8',
    'M 4 115 a 8 8 0 0 0 8 8',
    'M 188 13 a 8 8 0 0 0 -8 -8',
    'M 188 115 a 8 8 0 0 1 -8 8',
    'M 4 4 a 8 8 0 0 0 -8 -8',
    'M 188 4 a 8 8 0 0 1 8 -8',
    'M 4 124 a 8 8 0 0 1 -8 8',
    'M 188 124 a 8 8 0 0 0 8 8',
  ];

  for (let index = 0; index < inputCount; index++) {
    const offset = 8 * (index + 1);
    const curve = 8 + index;
    rails.push(
      'M 4 13',
      cubic([0, curve], [0, -curve], [offset, 20]),
      'l 0 60',
      cubic([0, curve], [0, -curve], [-offset, 20]),
    );
  }

  for (let index = 0; index < outputCount; index++) {
    const offset = -8 * (index + 1);
    const curve = 8 + index;
    rails.push(
      'M 188 13',
      cubic([0, curve], [0, -curve], [offset, 20]),
      'l 0 60',
      cubic([0, curve], [0, -curve], [-offset, 20]),
    );
  }

  return rails.join(' ');
}

function StationStops({ side, resources }: { side: 'in' | 'out'; resources: ResourceId[] }) {
  return (
    <g class="cell-radar-stops">
      {resources.map((resource, index) => {
        const offset = 8 * (index + 1);
        const input = side === 'in';
        const x = input ? 4 + offset - 2 : 188 - offset + 2;
        const y = input ? 84 : 38;
        return (
          <circle key={resource} cx={x} cy={y} r="1.8">
            <title>{resourceName(resource)}</title>
          </circle>
        );
      })}
    </g>
  );
}
