import type { DesignDirection, DesignPosition } from '../design.ts';
import type { TileMachine, TileTransportRules } from './types.ts';

export interface SolidAccessOption {
  machineId: string;
  side: 'input' | 'output';
  face: DesignDirection;
  base: DesignPosition;
  belt: DesignPosition;
  direction: DesignDirection;
  reach: 1 | 2;
  capacity: number;
}

/** Direct machine-to-belt sites. The base is the only occupied cell between endpoints. */
export function solidAccessOptions(
  machine: TileMachine,
  position: DesignPosition,
  rules: TileTransportRules,
): SolidAccessOption[] {
  const options: SolidAccessOption[] = [];
  const { width, height } = machine.size;
  for (const side of ['input', 'output'] as const) {
    for (const rule of rules.inserters) {
      if (rule.reach !== 1 && rule.reach !== 2) continue;
      for (const [face, vector, count] of [
        ['west', { x: -1, y: 0 }, height],
        ['east', { x: 1, y: 0 }, height],
        ['north', { x: 0, y: -1 }, width],
        ['south', { x: 0, y: 1 }, width],
      ] as const) {
        for (let offset = 0; offset < count; offset++) {
          const edge = {
            x: position.x + (face === 'east' ? width - 1 : face === 'west' ? 0 : offset),
            y: position.y + (face === 'south' ? height - 1 : face === 'north' ? 0 : offset),
          };
          const base = { x: edge.x + vector.x * rule.reach, y: edge.y + vector.y * rule.reach };
          const belt = {
            x: edge.x + vector.x * rule.reach * 2,
            y: edge.y + vector.y * rule.reach * 2,
          };
          const direction = side === 'output' ? face : opposite(face);
          options.push({
            machineId: machine.id,
            side,
            face,
            base,
            belt,
            direction,
            reach: rule.reach,
            capacity: rule.capacity,
          });
        }
      }
    }
  }
  return options;
}

function opposite(direction: DesignDirection): DesignDirection {
  return { north: 'south', east: 'west', south: 'north', west: 'east' }[
    direction
  ] as DesignDirection;
}
