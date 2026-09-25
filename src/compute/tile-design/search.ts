import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import { validateTileDesign } from '../design-validation/validate.ts';
import type { SolidAccessOption } from './access.ts';
import { allocateSolidRates, RATE_EPSILON, requiredUnits } from './capacity.ts';
import { emitTile } from './emit.ts';
import { mirroredFluidPair, stackMirroredTiles } from './mirrored-pair.ts';
import { routeFrames } from './routes.ts';
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
  scope:
    | 'one-machine/external-items/straight-surface-trunks'
    | 'one-machine/external-items-and-fluids/horizontal-branches/in-tile-belt-tunnels'
    | 'mirrored-fluid-pair/horizontal-branches';
  bestScore?: { area: number; transportEntities: number };
}

export type TileDesignSearchResult =
  | {
      status: 'found';
      candidate: TileDesignCandidate;
      validation: TileValidationResult;
      /** A valid incumbent; optimal is true only when the reported scope was fully searched. */
      optimal: boolean;
      stopReason: 'complete' | 'budget-exhausted' | 'first-valid';
      diagnostics: TileSearchDiagnostics;
    }
  | {
      status: 'unsupported' | 'invalid-input' | 'envelope-exhausted' | 'budget-exhausted';
      reason: string;
      diagnostics: TileSearchDiagnostics;
    };

/** Bounded geometry and rate allocation with independent emission validation. Translation and
 * machine-height pitch (twice that height for a mirrored pair) are fixed; selected ports face east/west trunks. Northbound
 * belts are canonical because reversal swaps free lane variables in this route family. Adapter
 * margins, phased trunks and bent belts will need additional route frames. */
export function solveTileDesign(input: TileDesignInput, allowPair = true): TileDesignSearchResult {
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
  if (input.machines.length !== 1)
    return failure('unsupported', 'Only one machine with external flows is supported.');
  const hasFluids = machine.inputs.fluids.length + machine.outputs.fluids.length > 0;
  if (hasFluids)
    diagnostics.scope =
      'one-machine/external-items-and-fluids/horizontal-branches/in-tile-belt-tunnels';
  if (!input.envelope.primitives.includes('surface'))
    return failure('unsupported', 'Surface trunks are required.');
  if (input.transport.inserters.some(({ reach }) => reach !== 1 && reach !== 2))
    return failure('unsupported', 'Only one- and two-tile inserter reach is supported.');
  for (const side of ['inputs', 'outputs'] as const) {
    const fluids = new Set(machine[side].fluids.map(({ resource }) => resource));
    if (
      fluids.size !== input.boundary[side].fluids.length ||
      input.boundary[side].fluids.some((fluid) => !fluids.has(fluid))
    )
      return failure('unsupported', 'Gross fluid transfers must be supplied/exported externally.');
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
  if (
    allowPair &&
    (['inputs', 'outputs'] as const).some(
      (side) => new Set(machine[side].fluids.map(({ resource }) => resource)).size >= 2,
    )
  ) {
    const pairBudget = Math.min(2_000, Math.floor(input.envelope.maxStates / 4));
    const pair = mirroredFluidPair(input, () => {
      if (diagnostics.exploredStates >= pairBudget) return false;
      diagnostics.exploredStates++;
      return true;
    });
    if (pair) {
      diagnostics.scope = 'mirrored-fluid-pair/horizontal-branches';
      diagnostics.bestScore = {
        area: pair.candidate.width * pair.candidate.pitch,
        transportEntities: pair.candidate.column.entities.length - 2,
      };
      return {
        status: 'found',
        candidate: pair.candidate,
        validation: pair.validation,
        optimal: false,
        stopReason: 'first-valid',
        diagnostics,
      };
    }
    if (machine.inputs.items.length + machine.outputs.items.length > 0) {
      for (const rotation of ['north', 'east', 'south', 'west'] as const) {
        if (diagnostics.exploredStates >= pairBudget) break;
        if (
          ![false, true].every((mirrored) =>
            machine.orientations.some(
              (orientation) =>
                orientation.rotation === rotation && orientation.mirrored === mirrored,
            ),
          )
        )
          continue;
        const halves = [false, true].map((mirrored) => {
          const remaining = pairBudget - diagnostics.exploredStates;
          if (remaining < 1) return undefined;
          const result = solveTileDesign(
            {
              ...input,
              machines: [{ ...machine, orientations: [{ rotation, mirrored }] }],
              envelope: { ...input.envelope, maxStates: Math.min(1_000, remaining) },
            },
            false,
          );
          diagnostics.exploredStates += result.diagnostics.exploredStates;
          return result.status === 'found' ? result.candidate : undefined;
        });
        if (!halves[0] || !halves[1]) continue;
        const stacked = stackMirroredTiles(input, halves[0], halves[1]);
        if (!stacked) continue;
        diagnostics.scope = 'mirrored-fluid-pair/horizontal-branches';
        diagnostics.bestScore = {
          area: stacked.candidate.width * stacked.candidate.pitch,
          transportEntities: stacked.candidate.column.entities.length - 2,
        };
        return {
          status: 'found',
          candidate: stacked.candidate,
          validation: stacked.validation,
          optimal: false,
          stopReason: 'first-valid',
          diagnostics,
        };
      }
    }
  }
  const demands: SolidDemand[] = (['input', 'output'] as const).flatMap((side) =>
    (side === 'input' ? machine.inputs : machine.outputs).items
      .toSorted((a, b) => a.resource.localeCompare(b.resource))
      .map((flow) => ({ ...flow, machineId: machine.id, side })),
  );
  const laneCapacity = input.transport.beltLaneCapacity / input.repeat.count;
  // Fluid routes can leave exactly the same item access geometry, even when their trunks
  // move or the machine is reflected. Reuse only fully exhausted capacity failures.
  const impossibleItemFrames = new Set<string>();
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

  function* frames() {
    for (const frame of solidTrackFrames(input, machine)) {
      if (exhausted) return;
      yield* routeFrames(input, frame, visit);
    }
  }
  for (const frame of frames()) {
    if (best && frame.area > best.candidate.width * best.candidate.pitch) continue;
    if (!visit()) break;
    const itemFrameKey = JSON.stringify([frame.tracks.map(({ x }) => x), frame.options]);
    if (impossibleItemFrames.has(itemFrameKey)) {
      diagnostics.capacityRejections++;
      continue;
    }
    let itemFeasible = false;
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
        itemFeasible = true;
        const candidate = emitTile(frame, allocation.transfers);
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
    if (!exhausted && !itemFeasible) impossibleItemFrames.add(itemFrameKey);
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
      : 'No allocation fits the width, pitch, repeat capacity, and compatible inserter sites using the reported trunk and branch primitives.',
  );
}

function baseKey(option: SolidAccessOption): string {
  return `${option.base.x},${option.base.y}`;
}
