import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import { validateTileDesign } from '../design-validation/validate.ts';
import type { SolidAccessOption } from './access.ts';
import { allocateSolidRates, RATE_EPSILON, requiredUnits } from './capacity.ts';
import { emitSolidTile } from './emit.ts';
import {
  reachesLane,
  solidTrackFrames,
  servesDemand,
  trackLanes,
  type AssignedSolidLane,
  type SolidDemand,
  type SolidLane,
} from './tracks.ts';
import type { TileDesignInput } from './types.ts';
import { validateSearchInput } from './validation.ts';

export interface TileSearchDiagnostics {
  exploredStates: number;
  capacityRejections: number;
  validationRejections: number;
  /** The actually searched family, even when the caller permits additional primitives. */
  scope: 'one-machine/external-items/straight-surface-trunks';
  bestScore?: { area: number; transportEntities: number };
}

export type TileDesignSearchResult =
  | {
      status: 'found';
      candidate: TileDesignCandidate;
      validation: TileValidationResult;
      /** Minimum area, then transport entity count, within the reported scope. Ties are deterministic. */
      optimal: boolean;
      stopReason: 'complete' | 'budget-exhausted';
      diagnostics: TileSearchDiagnostics;
    }
  | {
      status: 'unsupported' | 'invalid-input' | 'envelope-exhausted' | 'budget-exhausted';
      reason: string;
      diagnostics: TileSearchDiagnostics;
    };

/** Bounded discrete allocation with an independent continuous rate adapter and emission/validation.
 * Translation is fixed. With straight external trunks, all useful attachments are east/west;
 * extra pitch, disconnected distant tracks, and padding are dominated. Belt reversal only renames
 * the free lane variables, so northbound is canonical for this family. Branch profiles will need
 * their own frames/attachments, without changing the demand or rate-allocation contracts. */
export function solveTileDesign(input: TileDesignInput): TileDesignSearchResult {
  const diagnostics: TileSearchDiagnostics = {
    exploredStates: 0,
    capacityRejections: 0,
    validationRejections: 0,
    scope: 'one-machine/external-items/straight-surface-trunks',
  };
  const failure = (
    status: Exclude<TileDesignSearchResult['status'], 'found'>,
    reason: string,
  ): TileDesignSearchResult => ({ status, reason, diagnostics });
  const invalid = validateSearchInput(input);
  if (invalid) return failure('invalid-input', invalid);
  const machine = input.machines[0];
  if (
    input.machines.length !== 1 ||
    machine.inputs.fluids.length ||
    machine.outputs.fluids.length ||
    input.boundary.inputs.fluids.length ||
    input.boundary.outputs.fluids.length
  )
    return failure('unsupported', 'Only one machine with external item flows is supported.');
  if (!input.envelope.primitives.includes('surface'))
    return failure('unsupported', 'Straight surface belts are required.');
  if (input.transport.inserters.some(({ reach }) => reach !== 1 && reach !== 2))
    return failure('unsupported', 'Only one- and two-tile inserter reach is supported.');
  if (!machine.orientations.some(({ mirrored }) => !mirrored))
    return failure('unsupported', 'Mirrored-only machine placements cannot yet be emitted.');
  for (const side of ['inputs', 'outputs'] as const) {
    const flows = machine[side].items;
    const boundary = input.boundary[side].items;
    if (
      flows.length !== boundary.length ||
      flows.some(
        (flow) =>
          !boundary.some(
            ({ resource, rate }) =>
              resource === flow.resource &&
              Math.abs(rate - flow.rate) <= RATE_EPSILON * Math.max(1, rate, flow.rate),
          ),
      )
    )
      return failure(
        'unsupported',
        'Gross machine transfers must be supplied/exported externally; internal recirculation is not supported.',
      );
  }
  const demands: SolidDemand[] = (['input', 'output'] as const).flatMap((side) =>
    (side === 'input' ? machine.inputs : machine.outputs).items
      .toSorted((a, b) => a.resource.localeCompare(b.resource))
      .map((flow) => ({ ...flow, machineId: machine.id, side })),
  );
  const laneCapacity = input.transport.beltLaneCapacity / input.repeat.count;
  let exhausted = false;
  let best: Extract<TileDesignSearchResult, { status: 'found' }> | undefined;
  function visit(): boolean {
    if (diagnostics.exploredStates >= input.envelope.maxStates) {
      exhausted = true;
      return false;
    }
    diagnostics.exploredStates++;
    return true;
  }

  for (const frame of solidTrackFrames(input, machine)) {
    if (best && frame.area > best.candidate.width * best.candidate.pitch) break;
    if (!visit()) break;
    const lanes = trackLanes(frame.tracks);
    // Fewest possible lanes first; output geometry is usually the tightest constraint.
    const domains = demands
      .map((demand) => ({
        demand,
        lanes: lanes.filter((lane) =>
          frame.options.some((option) => servesDemand(option, demand) && reachesLane(option, lane)),
        ),
      }))
      .sort(
        (a, b) =>
          a.lanes.length - b.lanes.length ||
          b.demand.rate - a.demand.rate ||
          a.demand.side.localeCompare(b.demand.side) ||
          a.demand.resource.localeCompare(b.demand.resource),
      );
    const assigned: AssignedSolidLane[] = [];
    const occupied = new Set<SolidLane>();

    function possible(demand: SolidDemand, available: SolidLane[]): boolean {
      if (available.length * laneCapacity + RATE_EPSILON < demand.rate) return false;
      const capacities = new Map<string, number>();
      for (const option of frame.options) {
        if (!servesDemand(option, demand) || !available.some((lane) => reachesLane(option, lane)))
          continue;
        const key = baseKey(option);
        capacities.set(key, Math.max(capacities.get(key) ?? 0, option.capacity));
      }
      return [...capacities.values()].reduce((a, b) => a + b, 0) + RATE_EPSILON >= demand.rate;
    }

    function allocateSites() {
      const seen = new Set<string>();
      const optionIds = new Map(frame.options.map((option, index) => [option, index]));
      function searchSites(options: SolidAccessOption[]) {
        if (exhausted) return;
        const key = options.map((option) => optionIds.get(option)).join(',');
        if (seen.has(key)) return;
        seen.add(key);
        if (!visit()) return;
        const allocation = allocateSolidRates(demands, assigned, options, laneCapacity);
        if (!allocation.feasible) {
          diagnostics.capacityRejections++;
          return;
        }
        if (allocation.conflict) {
          const group = allocation.conflict;
          // Selecting a configuration does not force positive flow, so no separate unused branch.
          for (const choice of group) {
            searchSites(options.filter((option) => !group.includes(option) || option === choice));
            if (exhausted) break;
          }
          return;
        }
        const candidate = emitSolidTile(frame.machine, frame.rotation, allocation.transfers);
        const score = {
          area: candidate.width * candidate.pitch,
          transportEntities: candidate.column.entities.length - 1,
        };
        const old = diagnostics.bestScore;
        if (
          !old ||
          score.area < old.area ||
          (score.area === old.area && score.transportEntities < old.transportEntities)
        ) {
          const validation = validateTileDesign(input, candidate);
          if (validation.valid) {
            diagnostics.bestScore = score;
            best = {
              status: 'found',
              candidate,
              validation,
              optimal: false,
              stopReason: 'budget-exhausted',
              diagnostics,
            };
          } else {
            diagnostics.validationRejections++;
          }
        }
        // Any solution using fewer inserters must omit at least one currently used base.
        // These branches also retain alternative configurations at all other bases.
        const used = new Set(allocation.transfers.map(({ option }) => baseKey(option)));
        const maxCapacity = Math.max(0, ...options.map(({ capacity }) => capacity));
        const lowerBound =
          requiredUnits(
            demands.filter(({ side }) => side === 'input').reduce((sum, { rate }) => sum + rate, 0),
            maxCapacity,
          ) +
          demands
            .filter(({ side }) => side === 'output')
            .reduce((sum, { rate }) => sum + requiredUnits(rate, maxCapacity), 0);
        if (used.size <= lowerBound || used.size === 0) return;
        for (const base of used) {
          searchSites(options.filter((option) => baseKey(option) !== base));
          if (exhausted) break;
        }
      }
      searchSites(frame.options);
    }

    function assignLanes(index: number) {
      if (exhausted || !visit()) return;
      if (index === domains.length) {
        if (frame.tracks.every((track) => assigned.some((lane) => lane.track === track)))
          allocateSites();
        return;
      }
      // Independent bounds are deliberately optimistic; the shared-base flow check follows.
      for (const domain of domains.slice(index)) {
        if (
          !possible(
            domain.demand,
            domain.lanes.filter((lane) => !occupied.has(lane)),
          )
        ) {
          diagnostics.capacityRejections++;
          return;
        }
      }
      const { demand, lanes: domain } = domains[index];
      const available = domain.filter((lane) => !occupied.has(lane));
      const reserved = domains
        .slice(index + 1)
        .reduce((sum, { demand }) => sum + requiredUnits(demand.rate, laneCapacity), 0);
      const maximum = Math.min(available.length, lanes.length - occupied.size - reserved);
      const minimum = requiredUnits(demand.rate, laneCapacity);
      for (let count = minimum; count <= maximum; count++) {
        const selected: SolidLane[] = [];
        function choose(start: number) {
          if (exhausted || !visit()) return;
          if (selected.length === count) {
            if (!possible(demand, selected)) return;
            for (const lane of selected) {
              occupied.add(lane);
              assigned.push({ ...lane, demand });
            }
            assignLanes(index + 1);
            assigned.splice(assigned.length - selected.length);
            for (const lane of selected) occupied.delete(lane);
            return;
          }
          for (let next = start; next <= available.length - (count - selected.length); next++) {
            selected.push(available[next]);
            choose(next + 1);
            selected.pop();
            if (exhausted) break;
          }
        }
        choose(0);
        if (exhausted) break;
      }
    }
    assignLanes(0);
    if (exhausted) break;
  }
  if (best) {
    best.optimal = !exhausted && diagnostics.validationRejections === 0;
    best.stopReason = exhausted ? 'budget-exhausted' : 'complete';
    return best;
  }
  return failure(
    exhausted ? 'budget-exhausted' : 'envelope-exhausted',
    exhausted
      ? 'The deterministic state budget ended before a valid allocation was found.'
      : 'No allocation fits the width, pitch, repeat capacity, and compatible inserter sites using straight surface trunks.',
  );
}

function baseKey(option: SolidAccessOption): string {
  return `${option.base.x},${option.base.y}`;
}
