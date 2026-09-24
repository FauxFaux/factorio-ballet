import type { TileBoundaryTrack } from '../design-validation/types.ts';
import type { SolidAccessOption } from './access.ts';

export interface SolidTrackChoice {
  boundary: TileBoundaryTrack;
  access: SolidAccessOption[];
  lane: 'left' | 'right';
  resource: string;
}

/** First-fit direct trunk allocation. A later search will branch over tracks and lanes. */
export function firstSolidTrack(
  options: SolidAccessOption[],
  side: 'input' | 'output',
  resource: string,
  rate: number,
  laneCapacity: number,
  repeatCount: number,
  width: number,
  pitch: number,
): SolidTrackChoice | undefined {
  const face = side === 'input' ? 'west' : 'east';
  const matching = options.filter(
    (option) =>
      option.side === side &&
      option.face === face &&
      option.belt.x >= 0 &&
      option.belt.x < width &&
      option.belt.y >= 0 &&
      option.belt.y < pitch,
  );
  const first = matching[0];
  if (!first || rate * repeatCount > laneCapacity) return undefined;
  const lane = side === 'input' ? 'left' : 'right';
  const selected: SolidAccessOption[] = [];
  let remaining = rate;
  for (const option of matching) {
    if (option.belt.x !== first.belt.x || option.reach !== first.reach) continue;
    if (selected.some(({ base }) => base.x === option.base.x && base.y === option.base.y)) continue;
    selected.push(option);
    remaining -= option.capacity;
    if (remaining <= 0) break;
  }
  if (remaining > 0) return undefined;
  return {
    boundary: {
      kind: 'belt',
      x: first.belt.x,
      direction: 'north',
      lanes: { [lane]: resource },
    },
    access: selected,
    lane,
    resource,
  };
}
