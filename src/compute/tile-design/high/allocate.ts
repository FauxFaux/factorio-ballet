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

/** Assign each input to one belt and each output to one or more dedicated belts.
 * Memoized matching tracks occupied belts and two shared edge budgets.
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
  if (demands.length > frame.tracks.length) return;
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
  function assignmentFor(demand: SolidDemand, track: HighTrack): HighAssignment | undefined {
    if (
      track.tunnels?.some(
        ({ top, bottom }) => bottom - top - 1 > input.transport.undergroundBeltReach,
      ) ||
      (track.tunnels?.length && !input.envelope.primitives.includes('underground'))
    )
      return;
    const reach = track.access.endsWith('far') ? 2 : 1;
    const capacity = capacities.get(reach)!;
    if (capacity <= 0) return;
    const endOutput = track.access === 'end' && demand.side === 'output';
    // A pair drops north and south onto different lanes. Each lane carries only
    // one machine's production per tile, unlike a shared side-output lane.
    const endSiteCapacity = Math.min(capacity, laneCapacity * frame.copies);
    const sites = requiredUnits(demand.rate, endOutput ? endSiteCapacity : capacity);
    if (track.access === 'end' && sites > (frame.copies === 1 ? 2 : 1)) return;
    const count = requiredUnits(demand.rate, laneCapacity);
    if (!endOutput && count > (demand.side === 'input' ? 2 : 1)) return;
    let copyLanes: HighAssignment['lanes'][];
    if (endOutput) {
      copyLanes =
        frame.copies === 2 ? [['right'], ['left']] : [sites === 2 ? ['right', 'left'] : ['right']];
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
    return { demand, track, lanes, copyLaneRates, sites, reach, capacity };
  }
  const domains = demands.map((demand) =>
    frame.tracks.flatMap((track, index) => {
      const assignment = assignmentFor(demand, track);
      return assignment ? [{ index, assignment }] : [];
    }),
  );
  if (domains.some((domain, index) => demands[index].side === 'input' && !domain.length)) return;
  const sideCapacity = (side: 'west' | 'east') => frame.sideRows[side].length;
  const memo = new Map<string, Allocation | undefined>();
  function match(index: number, mask: bigint, west: number, east: number): Allocation | undefined {
    const key = `${index}:${mask}:${west}:${east}`;
    if (memo.has(key)) return memo.get(key);
    if (!visit()) return;
    if (index === demands.length) {
      const tracks = frame.tracks.filter((_track, index) => mask & (1n << BigInt(index)));
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
    const demand = demands[index];
    function consider(
      assignments: HighAssignment[],
      nextMask: bigint,
      nextWest: number,
      nextEast: number,
    ) {
      const tail = match(index + 1, nextMask, nextWest, nextEast);
      if (!tail) return;
      const allocation: Allocation = {
        assignments: [...assignments, ...tail.assignments],
        score: {
          ...tail.score,
          transportEntities:
            tail.score.transportEntities +
            assignments.reduce((sum, assignment) => sum + assignment.sites, 0),
        },
      };
      if (!best || compareHighScores(allocation.score, best.score) < -RATE_EPSILON)
        best = allocation;
    }
    if (demand.side === 'input') {
      for (const { index: trackIndex, assignment } of domains[index]) {
        if (mask & (1n << BigInt(trackIndex))) continue;
        const nextWest = west + (assignment.track.access.startsWith('west') ? assignment.sites : 0);
        const nextEast = east + (assignment.track.access.startsWith('east') ? assignment.sites : 0);
        if (nextWest > sideCapacity('west') || nextEast > sideCapacity('east')) continue;
        consider([assignment], mask | (1n << BigInt(trackIndex)), nextWest, nextEast);
      }
    } else {
      // Enumerate capacity covers. Each site's contribution is bounded by its
      // actual target lane; proportional splitting then fills a feasible cover.
      function cover(
        start: number,
        assignments: HighAssignment[],
        total: number,
        nextMask: bigint,
        nextWest: number,
        nextEast: number,
      ) {
        if (!visit()) return;
        if (total + RATE_EPSILON >= demand.rate) {
          const split = assignments.map((assignment) =>
            assignmentFor(
              { ...demand, rate: (demand.rate * assignment.demand.rate) / total },
              assignment.track,
            )!,
          );
          const used = (side: 'west' | 'east') =>
            split.reduce(
              (sum, assignment) =>
                sum + (assignment.track.access.startsWith(side) ? assignment.sites : 0),
              0,
            );
          consider(split, nextMask, west + used('west'), east + used('east'));
          return;
        }
        for (let trackIndex = start; trackIndex < frame.tracks.length; trackIndex++) {
          if (nextMask & (1n << BigInt(trackIndex))) continue;
          const track = frame.tracks[trackIndex];
          const reach = track.access.endsWith('far') ? 2 : 1;
          const capacity = capacities.get(reach)!;
          const side = track.access.startsWith('west')
            ? 'west'
            : track.access.startsWith('east')
              ? 'east'
              : undefined;
          const freeSites = side
            ? sideCapacity(side) - (side === 'west' ? nextWest : nextEast)
            : frame.copies === 1
              ? 2
              : 1;
          for (let sites = 1; sites <= freeSites; sites++) {
            const rate = Math.min(
              demand.rate,
              sites * capacity,
              track.access === 'end'
                ? sites * Math.min(capacity, laneCapacity * frame.copies)
                : laneCapacity,
            );
            if (rate <= RATE_EPSILON) continue;
            const assignment = assignmentFor({ ...demand, rate }, track);
            if (!assignment || assignment.sites !== sites) continue;
            cover(
              trackIndex + 1,
              [...assignments, assignment],
              total + rate,
              nextMask | (1n << BigInt(trackIndex)),
              nextWest + (side === 'west' ? sites : 0),
              nextEast + (side === 'east' ? sites : 0),
            );
          }
        }
      }
      cover(0, [], 0, mask, west, east);
    }
    memo.set(key, best);
    return best;
  }
  return match(0, 0n, 0, 0);
}

export function compareHighScores(a: Allocation['score'], b: Allocation['score']): number {
  return a.area - b.area || a.transportEntities - b.transportEntities;
}
