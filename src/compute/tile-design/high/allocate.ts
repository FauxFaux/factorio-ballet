import { requiredUnits, RATE_EPSILON } from '../capacity.ts';
import type { SolidDemand } from '../tracks.ts';
import type { TileDesignInput } from '../types.ts';
import { highBounds, type HighFrame, type HighTrack } from './geometry.ts';

export interface HighAssignment {
  demand: SolidDemand;
  track: HighTrack;
  lanes: ('left' | 'right')[];
  /** End outputs on opposite machine ends target opposite lanes of the same belt. */
  copyLaneRates: Partial<Record<'left' | 'right', number>>[];
  sites: number;
  reach: 1 | 2;
  capacity: number;
}
interface Allocation {
  assignments: HighAssignment[];
  /** Compare area and transport entity count per machine, so a touching pair can win. */
  score: { area: number; transportEntities: number };
}

/** Assign each gross item flow to one whole belt. A memoized matching problem over
 * seven belt bits and two edge budgets replaces lane subsets and fractional flow.
 * Both input lanes may carry the same item, supplied as a balanced split upstream.
 * Side outputs use one far lane; end outputs use the lane targeted by each site. */
export function allocateHighBelts(
  input: TileDesignInput,
  frame: HighFrame,
  visit: () => boolean,
): Allocation | undefined {
  const machine = input.machines[0];
  const demands: SolidDemand[] = (['input', 'output'] as const)
    .flatMap((side) =>
      (side === 'input' ? machine.inputs : machine.outputs).items.map((flow) => ({
        ...flow,
        machineId: machine.id,
        side,
      })),
    )
    .sort(
      (a, b) =>
        a.side.localeCompare(b.side) || b.rate - a.rate || a.resource.localeCompare(b.resource),
    );
  if (demands.length > 7) return;
  const capacities = new Map(
    [1, 2].map((reach) => [
      reach,
      Math.max(
        0,
        ...input.transport.inserters
          .filter((rule) => rule.reach === reach)
          .map(({ capacity }) => capacity),
      ),
    ]),
  );
  const laneCapacity = input.transport.beltLaneCapacity / (input.repeat.count * frame.copies);
  const domains = demands.map((demand) =>
    frame.tracks.flatMap((track, index) => {
      if (
        track.tunnels?.some(
          ({ top, bottom }) => bottom - top - 1 > input.transport.undergroundBeltReach,
        ) ||
        (track.tunnels?.length && !input.envelope.primitives.includes('underground'))
      )
        return [];
      const reach = track.access.endsWith('far') ? 2 : 1;
      const capacity = capacities.get(reach)!;
      if (capacity <= 0) return [];
      const endOutput = track.access === 'end' && demand.side === 'output';
      // A pair drops north and south onto different lanes. Each lane carries only
      // one machine's production per tile, unlike a shared side-output lane.
      const endSiteCapacity = Math.min(capacity, laneCapacity * frame.copies);
      const sites = requiredUnits(demand.rate, endOutput ? endSiteCapacity : capacity);
      if (track.access === 'end' && sites > (frame.copies === 1 ? 2 : 1)) return [];
      const count = requiredUnits(demand.rate, laneCapacity);
      if (!endOutput && count > (demand.side === 'input' ? 2 : 1)) return [];
      let copyLanes: HighAssignment['lanes'][];
      if (endOutput) {
        copyLanes =
          frame.copies === 2
            ? [['right'], ['left']]
            : [sites === 2 ? ['right', 'left'] : ['right']];
      } else {
        const lanes: HighAssignment['lanes'] =
          demand.side === 'output'
            ? [track.access.startsWith('east') ? 'right' : 'left']
            : count === 2
              ? ['left', 'right']
              : ['left'];
        copyLanes = Array.from({ length: frame.copies }, () => lanes);
      }
      const lanes = [...new Set(copyLanes.flat())].sort();
      const copyLaneRates = copyLanes.map((lanes) =>
        Object.fromEntries(lanes.map((lane) => [lane, demand.rate / lanes.length])),
      );
      return [
        {
          index,
          assignment: {
            demand,
            track,
            lanes,
            copyLaneRates,
            sites,
            reach,
            capacity,
          } satisfies HighAssignment,
        },
      ];
    }),
  );
  if (domains.some((domain) => !domain.length)) return;
  const sideCapacity = (side: 'west' | 'east') => frame.sideRows[side].length;
  const memo = new Map<string, Allocation | undefined>();
  function match(index: number, mask: number, west: number, east: number): Allocation | undefined {
    const key = `${index}:${mask}:${west}:${east}`;
    if (memo.has(key)) return memo.get(key);
    if (!visit()) return;
    if (index === demands.length) {
      const tracks = frame.tracks.filter((_track, index) => mask & (1 << index));
      const { width } = highBounds(frame, tracks);
      if (width > input.envelope.maxWidth) return;
      const belts = tracks.reduce(
        (sum, track) =>
          sum +
          frame.pitch -
          (track.tunnels ?? []).reduce((hidden, { top, bottom }) => hidden + bottom - top - 1, 0),
        0,
      );
      return {
        assignments: [],
        score: {
          area: (width * frame.pitch) / frame.copies,
          transportEntities: (belts + frame.pipes.length) / frame.copies,
        },
      };
    }
    let best: Allocation | undefined;
    for (const { index: trackIndex, assignment } of domains[index]) {
      if (mask & (1 << trackIndex)) continue;
      const nextWest = west + (assignment.track.access.startsWith('west') ? assignment.sites : 0);
      const nextEast = east + (assignment.track.access.startsWith('east') ? assignment.sites : 0);
      if (nextWest > sideCapacity('west') || nextEast > sideCapacity('east')) continue;
      const tail = match(index + 1, mask | (1 << trackIndex), nextWest, nextEast);
      if (!tail) continue;
      const allocation: Allocation = {
        assignments: [assignment, ...tail.assignments],
        score: {
          ...tail.score,
          transportEntities: tail.score.transportEntities + assignment.sites,
        },
      };
      if (!best || compareHighScores(allocation.score, best.score) < -RATE_EPSILON)
        best = allocation;
    }
    memo.set(key, best);
    return best;
  }
  return match(0, 0, 0, 0);
}

export function compareHighScores(a: Allocation['score'], b: Allocation['score']): number {
  return a.area - b.area || a.transportEntities - b.transportEntities;
}
