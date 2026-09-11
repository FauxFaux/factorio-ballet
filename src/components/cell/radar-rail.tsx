import { resourceName } from '../../data/index.ts';
import type { ResourceId } from '../../types.ts';

export type StationLayout = 'narrow' | 'wide';

function stationOffset(index: number, layout: StationLayout): number {
  return layout === 'wide' ? 8 + index * 12 : 8 * (index + 1);
}

export function stationFanWidth(stationCount: number, layout: StationLayout): number {
  return stationCount === 0 ? 0 : stationOffset(stationCount - 1, layout);
}

export function RailBorder() {
  return (
    <g class="cell-radar-border">
      <rect x="3" y="4" width="2" height="120" />
      <rect x="187" y="4" width="2" height="120" />
      <rect x="0" y="4" width="192" height="2" />
      <rect x="0" y="122" width="192" height="2" />
    </g>
  );
}

export function railPath(
  inputCount: number,
  outputCount: number,
  layout: StationLayout = 'narrow',
): string {
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
    const offset = stationOffset(index, layout);
    const curve = 8 + index;
    rails.push(
      'M 4 13',
      cubic([0, curve], [0, -curve], [offset, 20]),
      'l 0 60',
      cubic([0, curve], [0, -curve], [-offset, 20]),
    );
  }
  for (let index = 0; index < outputCount; index++) {
    const offset = -stationOffset(index, layout);
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

const stackedStationBottomY = 112;
const stackedStationPitch = 10;

export function stackedRailPath(
  inputCount: number,
  outputCount: number,
  layout: StationLayout = 'narrow',
): string {
  const rails = [railPath(0, outputCount, layout)];
  if (inputCount > 0) {
    const topStationY = stackedStationBottomY - (inputCount - 1) * stackedStationPitch;
    const rightTrunkTopY = topStationY + 8;
    rails.push('M 4 13 c 0 6, 4 7, 4 11 l 0 80');
    if (inputCount > 1)
      rails.push(
        `M 60 ${rightTrunkTopY} l 0 ${stackedStationBottomY - rightTrunkTopY} c 0 7, 8 11, 16 11`,
      );
  }
  for (let index = 0; index < inputCount; index++) {
    const y = stackedStationBottomY - index * stackedStationPitch;
    rails.push(
      `M 8 ${y - 8}`,
      'c 0 4, 4 8, 8 8',
      'l 36 0',
      index === 0 ? 'c 8 0, 8 11, 24 11' : 'c 4 0, 8 4, 8 8',
    );
  }
  return rails.join(' ');
}

export function stackedInputStationStop(index: number): { x: number; y: number } {
  return { x: 48, y: stackedStationBottomY - index * stackedStationPitch };
}
export function stationStop(
  side: 'in' | 'out',
  index: number,
  stacked = false,
  layout: StationLayout = 'narrow',
): { x: number; y: number } {
  if (side === 'in' && stacked) return stackedInputStationStop(index);
  const offset = stationOffset(index, layout);
  return { x: side === 'in' ? 4 + offset - 2 : 188 - offset + 2, y: side === 'in' ? 84 : 38 };
}

export function StationStops({
  side,
  resources,
  stacked = false,
  layout = 'narrow',
}: {
  side: 'in' | 'out';
  resources: ResourceId[];
  stacked?: boolean;
  layout?: StationLayout;
}) {
  return (
    <g class="cell-radar-stops">
      {resources.map((resource, index) => {
        const { x, y } = stationStop(side, index, stacked, layout);
        return (
          <circle
            key={resource}
            cx={x}
            cy={y}
            r="1.8"
            data-bus-route={`bus:${resource}`}
            data-resource={resource}
            data-bus-segment="station"
            data-bus-direction={side === 'in' ? 'onto-bus' : 'off-bus'}
            data-station-id={`station:${side === 'in' ? 'import' : 'export'}:${resource}`}
          >
            <title>{resourceName(resource)}</title>
          </circle>
        );
      })}
    </g>
  );
}
