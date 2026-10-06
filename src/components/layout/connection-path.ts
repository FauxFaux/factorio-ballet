import type { Position } from '../../bp/decode.ts';
import type { ModulePortReference } from '../../compute/module-port-connections.ts';
import type { DesignDirection } from '../../compute/design.ts';

/** Flow direction normal to the rotated module boundary, shared by arrows and curves. */
export function modulePortAngle(
  port: ModulePortReference,
  rotation: DesignDirection = 'north',
  side: 'input' | 'output',
): number {
  const outward = { right: 0, bottom: 90, left: 180, top: 270 }[port.edge];
  return (
    outward + { north: 0, east: 90, south: 180, west: 270 }[rotation] + (side === 'input' ? 180 : 0)
  );
}

/** Cubic handles follow the flow at both ends, so every curve meets its arrow head-on. */
export function connectionPath(
  start: Position,
  end: Position,
  startAngle: number,
  endAngle: number,
  bend = 0,
): string {
  const distance = Math.max(3, Math.min(20, Math.hypot(end.x - start.x, end.y - start.y) / 3));
  const handle = (point: Position, angle: number, length: number) => {
    const radians = (angle * Math.PI) / 180;
    // Round cardinal vectors to avoid tiny sideways offsets from floating point trig.
    const dx = Math.round(Math.cos(radians));
    const dy = Math.round(Math.sin(radians));
    return `${point.x + dx * length} ${point.y + dy * length}`;
  };
  return `M ${start.x} ${start.y} C ${handle(start, startAngle, Math.max(3, distance + bend))} ${handle(end, endAngle, -Math.max(3, distance - bend))} ${end.x} ${end.y}`;
}
