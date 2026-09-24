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

/** Direct machine-to-belt sites. Arms may cross occupied cells; only the base occupies space.
 * A long inserter may stand one OR two cells from the edge if its endpoint is in the machine. */
export function solidAccessOptions(
  machine: TileMachine,
  position: DesignPosition,
  rules: TileTransportRules,
): SolidAccessOption[] {
  const options: SolidAccessOption[] = [];
  const { width, height } = machine.size;
  // Rules with identical geometry are interchangeable in the constant-capacity model.
  const capacities = new Map<1 | 2, number>();
  for (const rule of rules.inserters) {
    if (rule.reach !== 1 && rule.reach !== 2) continue;
    capacities.set(rule.reach, Math.max(capacities.get(rule.reach) ?? 0, rule.capacity));
  }
  for (const side of ['input', 'output'] as const) {
    for (const [reach, capacity] of [...capacities].sort(([a], [b]) => a - b)) {
      for (const [face, vector, count, depth] of [
        ['west', { x: -1, y: 0 }, height, width],
        ['east', { x: 1, y: 0 }, height, width],
        ['north', { x: 0, y: -1 }, width, height],
        ['south', { x: 0, y: 1 }, width, height],
      ] as const) {
        for (let distance = 1; distance <= reach; distance++) {
          if (reach - distance >= depth) continue;
          for (let offset = 0; offset < count; offset++) {
            const edge = {
              x: position.x + (face === 'east' ? width - 1 : face === 'west' ? 0 : offset),
              y: position.y + (face === 'south' ? height - 1 : face === 'north' ? 0 : offset),
            };
            options.push({
              machineId: machine.id,
              side,
              face,
              base: { x: edge.x + vector.x * distance, y: edge.y + vector.y * distance },
              belt: {
                x: edge.x + vector.x * (distance + reach),
                y: edge.y + vector.y * (distance + reach),
              },
              direction: side === 'output' ? face : opposite(face),
              reach,
              capacity,
            });
          }
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
