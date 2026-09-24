import { solidAccessOptions, type SolidAccessOption } from './access.ts';
import type { ItemFlow, TileDesignInput, TileMachine } from './types.ts';
import type { DesignDirection } from '../design.ts';

export interface SolidDemand extends ItemFlow {
  machineId: string;
  side: 'input' | 'output';
}

/** A surface profile today; future bent/underground profiles can expose different row attachments. */
export interface SolidTrack {
  x: number;
  direction: 'north';
  profile: 'surface';
}

export interface SolidLane {
  track: SolidTrack;
  lane: 'left' | 'right';
}

export interface AssignedSolidLane extends SolidLane {
  demand: SolidDemand;
}

export function reachesLane(option: SolidAccessOption, lane: SolidLane): boolean {
  if (option.belt.x !== lane.track.x) return false;
  // A northbound belt receives output on the far lane, never both lanes from the same side.
  return option.side === 'input' || lane.lane === (option.face === 'east' ? 'right' : 'left');
}

export function servesDemand(option: SolidAccessOption, demand: SolidDemand): boolean {
  return option.machineId === demand.machineId && option.side === demand.side;
}

export function trackLanes(tracks: SolidTrack[]): SolidLane[] {
  return tracks.flatMap((track) => (['left', 'right'] as const).map((lane) => ({ track, lane })));
}

export interface SolidTrackFrame {
  machine: TileMachine;
  rotation: DesignDirection;
  tracks: SolidTrack[];
  options: SolidAccessOption[];
  area: number;
}

/** Enumerate only reachable track subsets. At most six columns for the current reach rules. */
export function solidTrackFrames(input: TileDesignInput, original: TileMachine): SolidTrackFrame[] {
  const result: SolidTrackFrame[] = [];
  const shapes = new Set<string>();
  for (const { rotation, mirrored } of original.orientations) {
    if (mirrored) continue;
    const swapped = rotation === 'east' || rotation === 'west';
    const size = swapped
      ? { width: original.size.height, height: original.size.width }
      : original.size;
    const shape = `${size.width},${size.height}`;
    if (shapes.has(shape)) continue;
    shapes.add(shape);
    if (
      size.height > input.envelope.maxPitch ||
      size.height * input.repeat.count > (input.repeat.moduleHeight ?? Infinity)
    )
      continue;
    const machine = { ...original, size };
    const accesses = solidAccessOptions(machine, { x: 0, y: 0 }, input.transport).filter(
      ({ face }) => face === 'west' || face === 'east',
    );
    const xs = [...new Set(accesses.map(({ belt }) => belt.x))].sort((a, b) => a - b);
    for (let mask = 0; mask < 2 ** xs.length; mask++) {
      const selected = xs.filter((_, index) => mask & (1 << index));
      const width = Math.max(size.width - 1, ...selected) - Math.min(0, ...selected) + 1;
      if (width > input.envelope.maxWidth) continue;
      const tracks: SolidTrack[] = selected.map((x) => ({
        x,
        direction: 'north',
        profile: 'surface',
      }));
      const options = accesses.filter(
        ({ base, belt }) => selected.includes(belt.x) && !selected.includes(base.x),
      );
      result.push({ machine, rotation, tracks, options, area: width * size.height });
    }
  }
  return result.sort(
    (a, b) =>
      a.area - b.area ||
      a.tracks.length * a.machine.size.height - b.tracks.length * b.machine.size.height,
  );
}
