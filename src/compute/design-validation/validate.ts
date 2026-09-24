import { validateBelts } from './belts.ts';
import { validateBoundary } from './boundaries.ts';
import { validateFluids } from './fluids.ts';
import type { DesignAssembler, DesignDirection, DesignPosition } from '../design.ts';
import type { TileMachine } from '../tile-design/types.ts';
import { entityPositionStatuses } from './geometry.ts';
import type {
  TileDesignCandidate,
  TileValidationInput,
  TileValidationIssue,
  TileValidationResult,
} from './types.ts';

const vectors: Record<DesignDirection, DesignPosition> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};
const add = (a: DesignPosition, b: DesignPosition) => ({ x: a.x + b.x, y: a.y + b.y });

/** Check a candidate against emitted geometry and fixed rates. No solver state is consulted. */
export function validateTileDesign(
  input: TileValidationInput,
  candidate: TileDesignCandidate,
): TileValidationResult {
  const issues: TileValidationIssue[] = [];
  const issue = (code: string, message: string, entityIndex?: number, resource?: string) =>
    issues.push({
      code,
      message,
      ...(entityIndex === undefined ? {} : { entityIndex }),
      ...(resource ? { resource } : {}),
    });
  const { entities } = candidate.column;
  if (
    !Number.isSafeInteger(candidate.width) ||
    candidate.width < 1 ||
    !Number.isSafeInteger(candidate.pitch) ||
    candidate.pitch < 1
  ) {
    issue('invalid-rectangle', 'Width and pitch must be positive integers.');
  }
  entityPositionStatuses(entities).forEach((status, index) => {
    if (status === 'overlap') issue('overlap', `Entity ${index} overlaps another entity.`, index);
  });
  entities.forEach((entity, index) => {
    const size =
      entity.kind === 'assembler'
        ? entity.size
        : entity.kind === 'splitter'
          ? entity.direction === 'north' || entity.direction === 'south'
            ? { width: 2, height: 1 }
            : { width: 1, height: 2 }
          : { width: 1, height: 1 };
    if (
      !Number.isSafeInteger(entity.position.x) ||
      !Number.isSafeInteger(entity.position.y) ||
      !Number.isSafeInteger(size.width) ||
      !Number.isSafeInteger(size.height) ||
      size.width < 1 ||
      size.height < 1 ||
      entity.position.x < 0 ||
      entity.position.y < 0 ||
      entity.position.x + size.width > candidate.width ||
      entity.position.y + size.height > candidate.pitch
    ) {
      issue('outside-rectangle', `Entity ${index} is outside the declared rectangle.`, index);
      return;
    }
  });

  const machines = new Map(input.machines.map((machine) => [machine.id, machine]));
  const assemblers = new Map<number, { entity: DesignAssembler; machine: TileMachine }>();
  const seenMachines = new Set<string>();
  entities.forEach((entity, index) => {
    if (entity.kind !== 'assembler') return;
    const id = candidate.machineIds[index];
    const machine = machines.get(id);
    if (!machine || seenMachines.has(id)) {
      issue('machine-identity', `Assembler ${index} has no unique matching machine ID.`, index);
      return;
    }
    seenMachines.add(id);
    const rotation = entity.direction ?? 'north';
    const allowed = machine.orientations.some(
      (orientation) => orientation.rotation === rotation && !orientation.mirrored,
    );
    const swapped = rotation === 'east' || rotation === 'west';
    if (
      !allowed ||
      entity.size.width !== (swapped ? machine.size.height : machine.size.width) ||
      entity.size.height !== (swapped ? machine.size.width : machine.size.height)
    ) {
      issue(
        'machine-geometry',
        `Assembler ${index} has an unsupported rotation or footprint.`,
        index,
      );
    }
    assemblers.set(index, { entity, machine });
  });
  for (const machine of input.machines)
    if (!seenMachines.has(machine.id))
      issue('missing-machine', `Machine ${machine.id} is missing.`);

  const { graph, lanes } = validateBelts(input, candidate, issue);

  const transferRates = new Map<string, number>();
  const laneRates = new Map<string, { input: number; output: number }>();
  const inserterRates = new Map<number, number>();
  const transferByInserter = new Map(
    graph.inserterTransfers.map((transfer) => [transfer.inserter.entity_number, transfer]),
  );
  for (const transfer of candidate.transfers) {
    const entity = entities[transfer.inserterIndex];
    const graphTransfer = transferByInserter.get(transfer.inserterIndex);
    if (
      entity?.kind !== 'inserter' ||
      !graphTransfer ||
      !Number.isFinite(transfer.rate) ||
      transfer.rate <= 0
    ) {
      issue(
        'invalid-transfer',
        'Transfer must use an inserter with a positive rate.',
        transfer.inserterIndex,
        transfer.resource,
      );
      continue;
    }
    const reach = entity.reach ?? 1;
    const rule = input.transport.inserters.find((rule) => rule.reach === reach);
    if (!rule)
      issue(
        'inserter-rule',
        'No declared inserter rule supports this reach.',
        transfer.inserterIndex,
      );
    const offset = vectors[entity.direction];
    const point = add(entity.position, {
      x: offset.x * reach * (transfer.side === 'input' ? 1 : -1),
      y: offset.y * reach * (transfer.side === 'input' ? 1 : -1),
    });
    const machine = [...assemblers.values()].find(
      ({ entity: assembler, machine }) =>
        machine.id === transfer.machineId && contains(assembler, point),
    );
    const flows =
      transfer.side === 'input' ? machine?.machine.inputs.items : machine?.machine.outputs.items;
    if (!flows?.some(({ resource }) => resource === transfer.resource))
      issue(
        'transfer-endpoint',
        'Inserter endpoint does not reach the named machine demand.',
        transfer.inserterIndex,
        transfer.resource,
      );
    const beltLanes =
      transfer.side === 'input'
        ? graphTransfer.sourceBeltLanes
        : graphTransfer.targetBeltLane
          ? [graphTransfer.targetBeltLane]
          : [];
    const beltLane = beltLanes.find(
      (lane) =>
        lane.lane === transfer.beltLane &&
        lanes.get(`${lane.entityNumber}:${lane.lane}`) === transfer.resource,
    );
    if (!beltLane)
      issue(
        'transfer-lane',
        'Inserter endpoint does not reach a lane carrying the resource.',
        transfer.inserterIndex,
        transfer.resource,
      );
    else {
      const belt = entities[beltLane.entityNumber];
      if (
        !candidate.boundary.some(
          (track) =>
            track.kind === 'belt' &&
            track.x === belt.position.x &&
            track.lanes?.[transfer.beltLane] === transfer.resource,
        )
      )
        issue(
          'transfer-boundary',
          'The transfer lane has no matching boundary supply or export.',
          transfer.inserterIndex,
          transfer.resource,
        );
      const laneKey = `${belt.position.x}:${transfer.beltLane}:${transfer.resource}`;
      const rates = laneRates.get(laneKey) ?? { input: 0, output: 0 };
      rates[transfer.side] += transfer.rate;
      laneRates.set(laneKey, rates);
    }
    if (
      transfer.side === 'output' &&
      machine &&
      machine.machine.outputs.items.length > 1 &&
      entity.filter !== transfer.resource
    )
      issue(
        'output-filter',
        'Multiple products require a matching output filter.',
        transfer.inserterIndex,
        transfer.resource,
      );
    const demandKey = `${transfer.machineId}:${transfer.side}:${transfer.resource}`;
    transferRates.set(demandKey, (transferRates.get(demandKey) ?? 0) + transfer.rate);
    inserterRates.set(
      transfer.inserterIndex,
      (inserterRates.get(transfer.inserterIndex) ?? 0) + transfer.rate,
    );
  }
  for (const [index, rate] of inserterRates) {
    const entity = entities[index];
    if (entity.kind !== 'inserter') continue;
    const capacity = Math.max(
      0,
      ...input.transport.inserters
        .filter((rule) => rule.reach === (entity.reach ?? 1))
        .map((rule) => rule.capacity),
    );
    if (rate > capacity + 1e-8)
      issue('inserter-capacity', `Inserter ${index} carries ${rate}, above ${capacity}.`, index);
  }
  for (const machine of input.machines)
    for (const side of ['input', 'output'] as const) {
      for (const { resource, rate } of (side === 'input' ? machine.inputs : machine.outputs)
        .items) {
        if (
          Math.abs((transferRates.get(`${machine.id}:${side}:${resource}`) ?? 0) - rate) >
          1e-8 * Math.max(1, rate)
        )
          issue(
            'machine-rate',
            `Machine ${machine.id} ${side} ${resource} rate is not met.`,
            undefined,
            resource,
          );
      }
    }

  validateFluids(candidate, assemblers, issue);
  validateBoundary(input, candidate, lanes, issue);
  const rateLimits = [
    input.repeat.moduleHeight === undefined
      ? Infinity
      : Math.floor(input.repeat.moduleHeight / candidate.pitch),
  ];
  for (const [lane, { input: consumed, output: produced }] of laneRates) {
    if (consumed > 0 && produced > 0)
      issue(
        'unsupported-flow',
        `Lane ${lane} has both production and consumption; cumulative load cannot yet be certified.`,
      );
    const rate = Math.max(consumed, produced);
    if (rate > 0) rateLimits.push(Math.floor(input.transport.beltLaneCapacity / rate));
  }
  for (const side of ['inputs', 'outputs'] as const)
    for (const { resource, rate } of input.boundary[side].items) {
      const laneCount = candidate.boundary
        .filter(
          (track) =>
            track.kind === 'belt' &&
            Object.values(track.lanes ?? {}).filter((value) => value === resource).length > 0,
        )
        .reduce(
          (sum, track) =>
            sum + Object.values(track.lanes ?? {}).filter((value) => value === resource).length,
          0,
        );
      rateLimits.push(
        laneCount === 0 ? 0 : Math.floor((laneCount * input.transport.beltLaneCapacity) / rate),
      );
    }
  const supportedCopies = Math.max(0, Math.min(...rateLimits));
  if (supportedCopies < input.repeat.count)
    issue(
      'repeat-capacity',
      `Only ${supportedCopies} copies fit the declared lane and height capacity.`,
    );
  return { valid: issues.length === 0, issues, supportedCopies };
}

function contains(machine: DesignAssembler, point: DesignPosition): boolean {
  return (
    point.x >= machine.position.x &&
    point.x < machine.position.x + machine.size.width &&
    point.y >= machine.position.y &&
    point.y < machine.position.y + machine.size.height
  );
}
