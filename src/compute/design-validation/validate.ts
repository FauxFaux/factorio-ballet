import { buildBeltGraph } from '../../bp/belt.ts';
import { beltLaneKey } from '../../bp/belt-model.ts';
import type { Entity } from '../../bp/decode.ts';
import type { DesignAssembler, DesignDirection, DesignEntity, DesignPosition } from '../design.ts';
import type { FluidAccess, TileMachine } from '../tile-design/types.ts';
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
const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
const key = ({ x, y }: DesignPosition) => `${x},${y}`;
const add = (a: DesignPosition, b: DesignPosition) => ({ x: a.x + b.x, y: a.y + b.y });
const opposite = (direction: DesignDirection) =>
  directions[(directions.indexOf(direction) + 2) % 4];

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

  const graph = buildBeltGraph(
    entities.flatMap((entity, index): Entity[] => {
      if (
        entity.kind !== 'belt' &&
        entity.kind !== 'underground-belt' &&
        entity.kind !== 'inserter'
      )
        return [];
      const direction = (directions.indexOf(entity.direction) * 4) as 0 | 4 | 8 | 12;
      const base = { entity_number: index, position: entity.position, direction };
      if (entity.kind === 'inserter') {
        const offset = vectors[entity.direction];
        const reach = entity.reach ?? 1;
        return [
          {
            ...base,
            name: 'inserter',
            pickup_position: [-offset.x * reach, -offset.y * reach],
            drop_position: [offset.x * reach, offset.y * reach],
          },
        ];
      }
      return [
        {
          ...base,
          name: entity.kind === 'belt' ? 'transport-belt' : 'underground-belt',
          ...(entity.kind === 'underground-belt' ? { type: entity.end } : {}),
        },
      ];
    }),
  );
  if (entities.some((entity) => entity.kind === 'splitter'))
    issue('unsupported-entity', 'Splitter validation is not yet supported.');
  for (const [index, entity] of entities.entries()) {
    if (entity.kind !== 'belt') continue;
    const track = candidate.boundary.find(
      (track) => track.kind === 'belt' && track.x === entity.position.x,
    );
    if (
      !track ||
      entity.direction !== track.direction ||
      (entity.direction !== 'north' && entity.direction !== 'south')
    )
      issue(
        'unsupported-belt-route',
        'Only straight vertical surface trunks can be certified.',
        index,
      );
  }
  const paired = new Set(
    graph.undergroundPairs.flatMap(({ inputEntityNumber, outputEntityNumber }) => [
      inputEntityNumber,
      outputEntityNumber,
    ]),
  );
  entities.forEach((entity, index) => {
    if (entity.kind === 'underground-belt' && !paired.has(index))
      issue('underground-pair', `Underground belt ${index} has no partner.`, index);
  });
  if (entities.some((entity) => entity.kind === 'underground-belt'))
    issue('unsupported-entity', 'Underground belt load and seam validation is not yet supported.');
  for (const pair of graph.undergroundPairs)
    if (pair.span - 2 > input.transport.undergroundBeltReach)
      issue(
        'underground-reach',
        'Underground belt exceeds the declared reach.',
        pair.inputEntityNumber,
      );

  const lanes = new Map<string, string>();
  for (const lane of candidate.lanes) {
    const entity = entities[lane.entityIndex];
    if (entity?.kind !== 'belt' && entity?.kind !== 'underground-belt') {
      issue('lane-entity', 'Lane assignment refers to a non-belt.', lane.entityIndex);
      continue;
    }
    const id = `${lane.entityIndex}:${lane.lane}`;
    if (lanes.has(id) && lanes.get(id) !== lane.resource)
      issue('mixed-lane', 'One lane has conflicting resources.', lane.entityIndex, lane.resource);
    lanes.set(id, lane.resource);
  }
  for (const { from, to } of graph.connections) {
    const source = lanes.get(`${from.entityNumber}:${from.lane}`);
    const target = lanes.get(`${to.entityNumber}:${to.lane}`);
    if (source && target && source !== target)
      issue('lane-continuity', `Connected lanes carry ${source} and ${target}.`, to.entityNumber);
  }
  const laneEdges = new Map<string, string[]>();
  for (const { from, to } of graph.connections) {
    const outgoing = laneEdges.get(beltLaneKey(from)) ?? [];
    outgoing.push(beltLaneKey(to));
    laneEdges.set(beltLaneKey(from), outgoing);
  }
  for (const track of candidate.boundary) {
    if (track.kind !== 'belt') continue;
    const bottom = entities.findIndex(
      (entity) =>
        entity.kind === 'belt' &&
        entity.position.x === track.x &&
        entity.position.y === candidate.pitch - 1,
    );
    const top = entities.findIndex(
      (entity) =>
        entity.kind === 'belt' && entity.position.x === track.x && entity.position.y === 0,
    );
    if (bottom < 0 || top < 0) continue;
    for (const side of ['left', 'right'] as const) {
      if (!track.lanes?.[side]) continue;
      const start = `${track.direction === 'north' ? bottom : top}:left:${side}:`;
      const destination = `${track.direction === 'north' ? top : bottom}:left:${side}:`;
      const pending = [start];
      const visited = new Set<string>();
      while (pending.length) {
        const current = pending.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const next of laneEdges.get(current) ?? []) pending.push(next);
      }
      if (!visited.has(destination))
        issue('boundary-continuity', `Belt lane ${side} at x=${track.x} does not cross the tile.`);
    }
  }

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

function validateBoundary(
  input: TileValidationInput,
  candidate: TileDesignCandidate,
  lanes: Map<string, string>,
  issue: (code: string, message: string, index?: number, resource?: string) => void,
) {
  const { entities } = candidate.column;
  const trackKeys = new Set<string>();
  const declared = new Set([
    ...input.boundary.inputs.items.map(({ resource }) => resource),
    ...input.boundary.outputs.items.map(({ resource }) => resource),
    ...input.boundary.inputs.fluids,
    ...input.boundary.outputs.fluids,
  ]);
  for (const track of candidate.boundary) {
    const trackKey = `${track.kind}:${track.x}`;
    if (trackKeys.has(trackKey))
      issue('boundary-duplicate', `Track ${trackKey} is declared twice.`);
    trackKeys.add(trackKey);
    if (track.kind === 'belt' && !Object.values(track.lanes ?? {}).some(Boolean))
      issue('boundary-resource', `Belt track at x=${track.x} has no lane assignment.`);
    for (const resource of track.kind === 'belt'
      ? Object.values(track.lanes ?? {})
      : [track.resource])
      if (resource && !declared.has(resource))
        issue(
          'boundary-resource',
          `Track at x=${track.x} advertises undeclared ${resource}.`,
          undefined,
          resource,
        );
    if (track.kind === 'pipe' && !track.resource)
      issue('boundary-resource', `Pipe track at x=${track.x} has no fluid assignment.`);
    const ends = [0, candidate.pitch - 1].map((y) =>
      entities.findIndex(
        (entity) =>
          entity.position.x === track.x &&
          entity.position.y === y &&
          (track.kind === 'belt' ? entity.kind === 'belt' : entity.kind === 'pipe'),
      ),
    );
    if (ends.some((index) => index < 0)) {
      issue('boundary-continuity', `Track at x=${track.x} does not reach both boundaries.`);
      continue;
    }
    if (track.kind === 'belt') {
      if (
        !track.direction ||
        ends.some(
          (index) =>
            (entities[index] as Extract<DesignEntity, { kind: 'belt' }>).direction !==
            track.direction,
        ) ||
        (track.direction !== 'north' && track.direction !== 'south')
      )
        issue('boundary-direction', `Belt track at x=${track.x} has inconsistent direction.`);
      for (const lane of ['left', 'right'] as const)
        if (
          track.lanes?.[lane] &&
          ends.some((index) => lanes.get(`${index}:${lane}`) !== track.lanes?.[lane])
        )
          issue(
            'boundary-lane',
            `Belt lane ${lane} at x=${track.x} does not match its declared resource.`,
          );
      for (let y = 0; y < candidate.pitch; y++) {
        const index = entities.findIndex(
          (entity) =>
            entity.kind === 'belt' && entity.position.x === track.x && entity.position.y === y,
        );
        if (index < 0) {
          issue('boundary-continuity', `Belt track at x=${track.x} is missing row ${y}.`);
          continue;
        }
        for (const lane of ['left', 'right'] as const)
          if (track.lanes?.[lane] && lanes.get(`${index}:${lane}`) !== track.lanes[lane])
            issue('boundary-lane', `Belt lane ${lane} at x=${track.x} changes resource.`, index);
      }
    }
  }
  for (const side of ['inputs', 'outputs'] as const) {
    for (const flow of input.boundary[side].items)
      if (
        !candidate.boundary.some(
          (track) =>
            track.kind === 'belt' && Object.values(track.lanes ?? {}).includes(flow.resource),
        )
      )
        issue(
          'missing-boundary-item',
          `No boundary track carries ${flow.resource}.`,
          undefined,
          flow.resource,
        );
    for (const resource of input.boundary[side].fluids)
      if (!candidate.boundary.some((track) => track.kind === 'pipe' && track.resource === resource))
        issue(
          'missing-boundary-fluid',
          `No boundary pipe carries ${resource}.`,
          undefined,
          resource,
        );
  }
}

function validateFluids(
  candidate: TileDesignCandidate,
  assemblers: Map<number, { entity: DesignAssembler; machine: TileMachine }>,
  issue: (code: string, message: string, index?: number, resource?: string) => void,
) {
  const { entities } = candidate.column;
  const pipeAt = new Map<string, number>();
  entities.forEach((entity, index) => {
    if (entity.kind === 'pipe' || entity.kind === 'underground-pipe')
      pipeAt.set(key(entity.position), index);
  });
  const parent = new Map<number, number>();
  const root = (index: number): number => {
    const p = parent.get(index);
    if (p === undefined || p === index) return index;
    const r = root(p);
    parent.set(index, r);
    return r;
  };
  const join = (a: number, b: number) => parent.set(root(a), root(b));
  for (const index of pipeAt.values()) {
    parent.set(index, index);
    const entity = entities[index];
    for (const direction of directions) {
      if (entity.kind === 'underground-pipe' && entity.direction !== direction) continue;
      const neighbor = pipeAt.get(key(add(entity.position, vectors[direction])));
      if (neighbor === undefined) continue;
      const other = entities[neighbor];
      if (other.kind === 'underground-pipe' && other.direction !== opposite(direction)) continue;
      join(index, neighbor);
    }
  }
  const fluidByRoot = new Map<number, string>();
  for (const { pipeIndex, resource } of candidate.fluids) {
    if (!parent.has(pipeIndex)) {
      issue('fluid-entity', 'Fluid assignment refers to a non-pipe.', pipeIndex);
      continue;
    }
    const network = root(pipeIndex);
    if (fluidByRoot.has(network) && fluidByRoot.get(network) !== resource)
      issue('fluid-mixing', 'Connected pipes carry incompatible fluids.', pipeIndex, resource);
    fluidByRoot.set(network, resource);
  }
  for (const track of candidate.boundary)
    if (track.kind === 'pipe') {
      const index = pipeAt.get(`${track.x},0`);
      const oppositeEnd = pipeAt.get(`${track.x},${candidate.pitch - 1}`);
      if (index !== undefined && oppositeEnd !== undefined && root(index) !== root(oppositeEnd))
        issue('boundary-continuity', `Pipe track at x=${track.x} is disconnected.`);
      if (index !== undefined && fluidByRoot.get(root(index)) !== track.resource)
        issue(
          'boundary-fluid',
          'Boundary pipe network has a different fluid.',
          index,
          track.resource,
        );
    }
  for (const { entity, machine } of assemblers.values())
    for (const side of ['input', 'output'] as const) {
      for (const access of (side === 'input' ? machine.inputs : machine.outputs).fluids) {
        for (const port of access.positions) {
          const pipe = portPipeIndex(entity, port, pipeAt);
          if (pipe !== undefined && fluidByRoot.get(root(pipe)) !== access.resource)
            issue(
              'fluid-port-mixing',
              `A pipe touches an incompatible ${access.resource} fluid box.`,
              pipe,
              access.resource,
            );
        }
        if (
          !access.positions.some((port) =>
            portPipe(entity, access, port, pipeAt, root, fluidByRoot),
          )
        )
          issue(
            'fluid-port',
            `Machine ${machine.id} has no connected ${side} port for ${access.resource}.`,
            undefined,
            access.resource,
          );
      }
    }
  if (entities.some((entity) => entity.kind === 'underground-pipe'))
    issue('unsupported-entity', 'Underground pipe pairing is not yet validated.');
}

function portPipe(
  entity: DesignAssembler,
  access: FluidAccess,
  port: FluidAccess['positions'][number],
  pipeAt: Map<string, number>,
  root: (index: number) => number,
  fluidByRoot: Map<number, string>,
): boolean {
  const index = portPipeIndex(entity, port, pipeAt);
  return index !== undefined && fluidByRoot.get(root(index)) === access.resource;
}

function portPipeIndex(
  entity: DesignAssembler,
  port: FluidAccess['positions'][number],
  pipeAt: Map<string, number>,
): number | undefined {
  const turns = directions.indexOf(entity.direction ?? 'north');
  let position = { ...port.position };
  for (let turn = 0; turn < turns; turn++) position = { x: -position.y, y: position.x };
  const direction = directions[(directions.indexOf(port.direction) + turns) % 4];
  const face = {
    x: entity.position.x + entity.size.width / 2 + position.x - 0.5,
    y: entity.position.y + entity.size.height / 2 + position.y - 0.5,
  };
  return pipeAt.get(key(add(face, vectors[direction])));
}
