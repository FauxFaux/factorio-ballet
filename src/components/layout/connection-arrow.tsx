import type { Position } from '../../bp/decode.ts';
import type { ResourceId } from '../../types.ts';
import { resourceName } from '../../data/index.ts';
import { useDataset } from '../../dataset/context.tsx';
import { iconSprite } from '../icon.tsx';

/** A flow arrow centred on a connection endpoint, with its resource just inside the entity. */
export function ConnectionArrow({
  point,
  angle,
  side,
  resource,
  scale = 1,
  showIcon = true,
}: {
  point: Position;
  angle: number;
  side: 'input' | 'output';
  resource: ResourceId;
  scale?: number;
  showIcon?: boolean;
}) {
  const { data, iconMap } = useDataset();
  const [url, spriteX, spriteY, sheetWidth, sheetHeight] = iconSprite(
    iconMap,
    resource,
    resource.startsWith('fluid:') ? 'fluid:fluid-unknown' : 'item:item-unknown',
  );
  const offset = side === 'input' ? 2 : -2;
  const radians = (angle * Math.PI) / 180;
  const iconX = point.x + Math.cos(radians) * offset * scale;
  const iconY = point.y + Math.sin(radians) * offset * scale;
  return (
    <g class="cell-layout-connection-arrow" data-flow-direction={side} data-resource={resource}>
      <title>{`${side === 'input' ? 'In' : 'Out'}: ${resourceName(data, resource)}`}</title>
      <path
        transform={`translate(${point.x} ${point.y}) rotate(${angle}) scale(${scale})`}
        d="M 0.8 0 L -0.7 -0.65 L -0.7 0.65 Z"
      />
      {showIcon && (
        <svg
          x={iconX - scale * 0.65}
          y={iconY - scale * 0.65}
          width={scale * 1.3}
          height={scale * 1.3}
          viewBox={`${spriteX} ${spriteY} 32 32`}
          aria-hidden="true"
        >
          <image href={url} width={sheetWidth} height={sheetHeight} />
        </svg>
      )}
    </g>
  );
}

export interface ConnectionArrowPoint {
  id: string;
  owner: string;
  point: Position;
  angle: number;
  side: 'input' | 'output';
  resource: ResourceId;
}

/** Adjacent endpoints on one entity share an icon, including chains of neighbouring lanes. */
export function ConnectionArrows({
  arrows,
  scale = 1,
}: {
  arrows: ConnectionArrowPoint[];
  scale?: number;
}) {
  const remaining = new Set(arrows.map((_, index) => index));
  const icons = new Set<number>();
  while (remaining.size) {
    const first = remaining.values().next().value!;
    remaining.delete(first);
    const group = [first];
    for (let cursor = 0; cursor < group.length; cursor++) {
      const arrow = arrows[group[cursor]!]!;
      for (const index of remaining) {
        const other = arrows[index]!;
        if (
          arrow.owner === other.owner &&
          arrow.resource === other.resource &&
          arrow.side === other.side &&
          Math.abs(((arrow.angle - other.angle + 540) % 360) - 180) < 1 &&
          Math.hypot(arrow.point.x - other.point.x, arrow.point.y - other.point.y) <= 1.5 * scale
        ) {
          remaining.delete(index);
          group.push(index);
        }
      }
    }
    const centre = group.reduce(
      (sum, index) => ({
        x: sum.x + arrows[index]!.point.x / group.length,
        y: sum.y + arrows[index]!.point.y / group.length,
      }),
      { x: 0, y: 0 },
    );
    group.sort(
      (a, b) =>
        Math.hypot(arrows[a]!.point.x - centre.x, arrows[a]!.point.y - centre.y) -
        Math.hypot(arrows[b]!.point.x - centre.x, arrows[b]!.point.y - centre.y),
    );
    icons.add(group[0]!);
  }
  return (
    <>
      {arrows.map((arrow, index) => (
        <ConnectionArrow key={arrow.id} {...arrow} scale={scale} showIcon={icons.has(index)} />
      ))}
    </>
  );
}
