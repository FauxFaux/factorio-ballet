import type { DesignDirection, DesignPosition, DesignSize } from '../design.ts';
import type { FluidAccess, TileMachineOrientation } from './types.ts';

export const cardinalDirections: DesignDirection[] = ['north', 'east', 'south', 'west'];
export const directionVectors: Record<DesignDirection, DesignPosition> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};
export const positionKey = ({ x, y }: DesignPosition) => `${x},${y}`;
export const oppositeDirection = (direction: DesignDirection): DesignDirection =>
  cardinalDirections[(cardinalDirections.indexOf(direction) + 2) % 4];

/** Centre-relative prototype ports become grid cells using the already rotated footprint. */
export function orientFluidPort(
  port: FluidAccess['positions'][number],
  size: DesignSize,
  orientation: TileMachineOrientation,
): { position: DesignPosition; direction: DesignDirection } {
  let { x, y } = port.position;
  let direction = port.direction;
  if (orientation.mirrored) {
    x = -x;
    if (direction === 'east' || direction === 'west') direction = oppositeDirection(direction);
  }
  const turns = cardinalDirections.indexOf(orientation.rotation);
  for (let i = 0; i < turns; i++) [x, y] = [-y, x];
  direction = cardinalDirections[(cardinalDirections.indexOf(direction) + turns) % 4];
  const vector = directionVectors[direction];
  return {
    position: { x: size.width / 2 - 0.5 + x + vector.x, y: size.height / 2 - 0.5 + y + vector.y },
    direction,
  };
}
