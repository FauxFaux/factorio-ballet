import { fluidBoxResources, type FluidBoxResource } from '../fluid-box-resources.ts';
import type { AssemblerSpecification, KernelProblem, KernelFlows } from '../kernel-problems.ts';
import type { DesignDirection } from '../design.ts';
import type { MachineSize, ResourceId } from '../../types.ts';

export type FlowSide = 'input' | 'output';
type FluidId = Extract<ResourceId, `fluid:${string}`>;

/** A named item transfer rate, used for either input or output. */
export interface ItemFlow {
  resource: string;
  rate: number;
}

/** One fluid's alternative connections in north-facing local coordinates. Transform its positions
 * with the selected machine orientation while keeping the resource attached to this access. */
export interface FluidAccess {
  resource: FluidId;
  positions: { position: { x: number; y: number }; direction: DesignDirection }[];
}

interface SidedFluidAccess extends FluidAccess {
  side: FlowSide;
}

export interface MachineFlows {
  items: ItemFlow[];
  fluids: FluidAccess[];
}

export interface BoundaryFlows {
  items: ItemFlow[];
  fluids: FluidId[];
}

/** Mirror local x coordinates before applying the cardinal rotation. */
export interface TileMachineOrientation {
  rotation: DesignDirection;
  mirrored: boolean;
}

export interface TileMachine {
  id: string;
  size: MachineSize;
  orientations: TileMachineOrientation[];
  inputs: MachineFlows;
  outputs: MachineFlows;
}

export interface TileBoundary {
  inputs: BoundaryFlows;
  outputs: BoundaryFlows;
}

export interface TileTransportRules {
  beltLaneCapacity: number;
  undergroundBeltReach: number;
  undergroundPipeReach: number;
  inserters: { id: string; capacity: number; reach: number }[];
  fluidThroughput: 'unlimited';
}

export interface TileSearchEnvelope {
  maxWidth: number;
  maxPitch: number;
  primitives: readonly ('surface' | 'underground' | 'branch' | 'direct-insertion')[];
  maxStates: number;
}

export interface TileDesignOptions {
  transport: TileTransportRules;
  envelope: TileSearchEnvelope;
  repeatCount?: number;
  moduleHeight?: number;
}

export interface TileDesignInput {
  machines: TileMachine[];
  boundary: TileBoundary;
  transport: TileTransportRules;
  envelope: TileSearchEnvelope;
  repeat: { count: number; moduleHeight?: number };
}

export interface InvalidTileDesignInput {
  kind: 'invalid-input';
  code:
    | 'invalid-rate'
    | 'invalid-resource'
    | 'invalid-machine'
    | 'invalid-fluid'
    | 'unbalanced-flow'
    | 'invalid-rule';
  message: string;
  machineId?: string;
  resource?: string;
}

export type TileDesignInputResult =
  | { kind: 'valid'; input: TileDesignInput }
  | InvalidTileDesignInput;

const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];

/** Convert fixed machine rates and a boundary contract into search-ready obligations. */
export function normalizeTileDesignInput(
  problem: KernelProblem,
  options: TileDesignOptions,
): TileDesignInputResult {
  const ruleError = validateOptions(options);
  if (ruleError) return ruleError;
  if (problem.assemblers.length === 0) {
    return invalid('invalid-machine', 'At least one machine is required.');
  }

  for (const [side, flows] of [
    ['input', problem.inputs],
    ['output', problem.outputs],
  ] as const) {
    for (const [kind, rates] of [
      ['solid', flows.solids],
      ['fluid', flows.fluids],
    ] as const) {
      for (const [resource, rate] of Object.entries(rates)) {
        const error = validateRate(resource, rate, `${side} boundary`);
        if (error) return error;
        if ((kind === 'fluid') !== resource.startsWith('fluid:')) {
          return invalid(
            'invalid-resource',
            `${resource} must use a ${kind === 'fluid' ? 'fluid:' : 'non-fluid'} resource ID.`,
            resource,
          );
        }
      }
    }
  }

  const machines: TileMachine[] = [];
  const usedIds = new Set<string>();
  for (const [index, specification] of problem.assemblers.entries()) {
    const id = specification.id ?? `machine-${index + 1}`;
    if (!id.trim() || usedIds.has(id)) {
      return invalid('invalid-machine', `Machine ID ${JSON.stringify(id)} is empty or repeated.`);
    }
    usedIds.add(id);
    const size = specification.size ?? { width: 3, height: 3 };
    if (!positiveInteger(size.width) || !positiveInteger(size.height)) {
      return invalid('invalid-machine', `Machine ${id} has an invalid footprint.`, undefined, id);
    }
    for (const [side, declarations] of [
      ['input', specification.fluidIngredients],
      ['output', specification.fluidProducts],
    ] as const) {
      for (const declaration of declarations ?? []) {
        if (!declaration.resource.startsWith('fluid:')) {
          return invalid(
            'invalid-resource',
            `${declaration.resource} must use a fluid: resource ID.`,
            declaration.resource,
            id,
          );
        }
        const rates =
          side === 'input' ? specification.inputPerSecond : specification.outputPerSecond;
        if (!(declaration.resource in rates)) {
          return invalid(
            'invalid-fluid',
            `Machine ${id} has no ${side} rate for ${declaration.resource}.`,
            declaration.resource,
            id,
          );
        }
      }
    }
    for (const [side, rates] of [
      ['input', specification.inputPerSecond],
      ['output', specification.outputPerSecond],
    ] as const) {
      for (const [resource, rate] of Object.entries(rates)) {
        const error = validateRate(resource, rate, `${side} of machine ${id}`);
        if (error) return error;
      }
    }
  }

  for (const [index, specification] of problem.assemblers.entries()) {
    const id = specification.id ?? `machine-${index + 1}`;
    const inputs = splitMachineFlows(specification.inputPerSecond);
    const outputs = splitMachineFlows(specification.outputPerSecond);
    const fluidAccesses = makeFluidAccesses(specification, id, inputs.fluids, outputs.fluids);
    if ('kind' in fluidAccesses) return fluidAccesses;
    machines.push({
      id,
      size: { ...(specification.size ?? { width: 3, height: 3 }) },
      orientations: machineOrientations(specification),
      inputs: {
        items: inputs.items,
        fluids: fluidAccesses
          .filter(({ side }) => side === 'input')
          .map(({ resource, positions }) => ({ resource, positions })),
      },
      outputs: {
        items: outputs.items,
        fluids: fluidAccesses
          .filter(({ side }) => side === 'output')
          .map(({ resource, positions }) => ({ resource, positions })),
      },
    });
  }

  const boundary: TileBoundary = {
    inputs: boundaryFlows(problem.inputs),
    outputs: boundaryFlows(problem.outputs),
  };
  const resources = new Set([
    ...Object.keys(problem.inputs.solids),
    ...Object.keys(problem.inputs.fluids),
    ...Object.keys(problem.outputs.solids),
    ...Object.keys(problem.outputs.fluids),
    ...problem.assemblers.flatMap((machine) => [
      ...Object.keys(machine.inputPerSecond),
      ...Object.keys(machine.outputPerSecond),
    ]),
  ]);
  for (const resource of [...resources].sort()) {
    const supplied = boundaryRate(problem.inputs, resource);
    const produced = problem.assemblers.reduce(
      (sum, machine) => sum + (machine.outputPerSecond[resource] ?? 0),
      0,
    );
    const consumed = problem.assemblers.reduce(
      (sum, machine) => sum + (machine.inputPerSecond[resource] ?? 0),
      0,
    );
    const exported = boundaryRate(problem.outputs, resource);
    if (
      Math.abs(supplied + produced - consumed - exported) >
      1e-8 * Math.max(1, supplied, produced, consumed, exported)
    ) {
      return invalid(
        'unbalanced-flow',
        `${resource}: external supply ${supplied} + production ${produced} does not equal consumption ${consumed} + external export ${exported}.`,
        resource,
      );
    }
  }

  return {
    kind: 'valid',
    input: {
      machines,
      boundary,
      transport: options.transport,
      envelope: options.envelope,
      repeat: {
        count: options.repeatCount ?? 1,
        ...(options.moduleHeight === undefined ? {} : { moduleHeight: options.moduleHeight }),
      },
    },
  };
}

function machineOrientations(specification: AssemblerSpecification): TileMachineOrientation[] {
  const size = specification.size ?? { width: 3, height: 3 };
  const hasFluidConnections = Boolean(specification.fluidBoxes?.length);
  if (size.width === size.height && !hasFluidConnections) {
    return [{ rotation: 'north', mirrored: false }];
  }
  return [false, ...(hasFluidConnections ? [true] : [])].flatMap((mirrored) =>
    directions.map((rotation) => ({ rotation, mirrored })),
  );
}

function makeFluidAccesses(
  specification: AssemblerSpecification,
  machineId: string,
  fluidInputs: FluidId[],
  fluidOutputs: FluidId[],
): SidedFluidAccess[] | InvalidTileDesignInput {
  if (fluidInputs.length + fluidOutputs.length === 0) return [];
  if (!specification.fluidBoxes) {
    return invalid(
      'invalid-fluid',
      `Machine ${machineId} has fluid demand without connection geometry.`,
      undefined,
      machineId,
    );
  }
  const inputOrder = orderedFluids(fluidInputs, specification.fluidIngredients, machineId, 'input');
  if ('kind' in inputOrder) return inputOrder;
  const outputOrder = orderedFluids(fluidOutputs, specification.fluidProducts, machineId, 'output');
  if ('kind' in outputOrder) return outputOrder;

  const inputAssigned = fluidBoxResources(specification, {
    ingredients: inputOrder,
    products: [],
  });
  const outputAssigned = fluidBoxResources(specification, {
    ingredients: [],
    products: outputOrder,
  });
  const accesses: SidedFluidAccess[] = [];
  for (const [index, resourceId] of inputAssigned) {
    const other = outputAssigned.get(index);
    if (other && other !== resourceId) {
      return invalid(
        'invalid-fluid',
        `Machine ${machineId} needs incompatible fluids at one position.`,
        resourceId,
        machineId,
      );
    }
  }
  for (const [side, assigned] of [
    ['input', inputAssigned],
    ['output', outputAssigned],
  ] as const) {
    for (const [index, resourceId] of assigned) {
      const resource = resourceId as FluidId;
      const box = specification.fluidBoxes[index]!;
      const positions = box.connections
        .filter(
          (connection) =>
            connection.flowDirection === side || connection.flowDirection === 'input-output',
        )
        .map(({ position, direction }) => ({ position: { ...position }, direction }));
      if (
        positions.length === 0 ||
        positions.some(
          ({ position, direction }) =>
            !Number.isInteger(position.x) ||
            !Number.isInteger(position.y) ||
            !directions.includes(direction),
        )
      ) {
        return invalid(
          'invalid-fluid',
          `Machine ${machineId} has no valid ${side} position for ${resource}.`,
          resource,
          machineId,
        );
      }
      accesses.push({ resource, side, positions });
    }
  }
  for (const [side, fluids] of [
    ['input', fluidInputs],
    ['output', fluidOutputs],
  ] as const) {
    for (const resource of fluids) {
      if (!accesses.some((access) => access.resource === resource && access.side === side)) {
        return invalid(
          'invalid-fluid',
          `Machine ${machineId} has no ${side} position for ${resource}.`,
          resource,
          machineId,
        );
      }
    }
  }
  return accesses;
}

function orderedFluids(
  fluidsForSide: FluidId[],
  declarations: FluidBoxResource[] | undefined,
  machineId: string,
  side: FlowSide,
): FluidBoxResource[] | InvalidTileDesignInput {
  if (!declarations) {
    if (fluidsForSide.length > 1) {
      return invalid(
        'invalid-fluid',
        `Machine ${machineId} needs an explicit ${side} assignment for its multiple fluids.`,
        undefined,
        machineId,
      );
    }
    return fluidsForSide.map((resource) => ({ resource }));
  }
  const expected = new Set<string>(fluidsForSide);
  const seen = new Set<string>();
  const claimed = new Set<number>();
  for (const { resource, fluidboxIndex } of declarations) {
    if (
      !expected.has(resource) ||
      seen.has(resource) ||
      (fluidboxIndex !== undefined &&
        (!positiveInteger(fluidboxIndex) || claimed.has(fluidboxIndex)))
    ) {
      return invalid(
        'invalid-fluid',
        `Machine ${machineId} has invalid ${side} assignment for ${resource}.`,
        resource,
        machineId,
      );
    }
    seen.add(resource);
    if (fluidboxIndex) claimed.add(fluidboxIndex);
  }
  if (seen.size !== expected.size) {
    return invalid(
      'invalid-fluid',
      `Machine ${machineId} is missing ${side} fluid assignment.`,
      undefined,
      machineId,
    );
  }
  return declarations;
}

function splitMachineFlows(rates: Record<string, number>): {
  items: ItemFlow[];
  fluids: FluidId[];
} {
  const items: ItemFlow[] = [];
  const fluids: FluidId[] = [];
  for (const [resource, rate] of Object.entries(rates)) {
    if (resource.startsWith('fluid:')) fluids.push(resource as FluidId);
    else items.push({ resource, rate });
  }
  items.sort((a, b) => a.resource.localeCompare(b.resource));
  fluids.sort();
  return { items, fluids };
}

function boundaryFlows(flows: KernelFlows): BoundaryFlows {
  return {
    items: Object.entries(flows.solids)
      .map(([resource, rate]) => ({ resource, rate }))
      .sort((a, b) => a.resource.localeCompare(b.resource)),
    fluids: Object.keys(flows.fluids).sort() as FluidId[],
  };
}

function boundaryRate(flows: KernelFlows, resource: string): number {
  return flows.solids[resource] ?? flows.fluids[resource] ?? 0;
}

function validateRate(
  resource: string,
  rate: number,
  where: string,
): InvalidTileDesignInput | undefined {
  if (!resource.trim())
    return invalid('invalid-resource', `An unnamed resource appears at ${where}.`);
  if (!Number.isFinite(rate) || rate <= 0) {
    return invalid(
      'invalid-rate',
      `${resource} has an invalid rate at ${where}; rates must be finite and positive.`,
      resource,
    );
  }
}

function validateOptions(options: TileDesignOptions): InvalidTileDesignInput | undefined {
  const { transport, envelope } = options;
  if (
    !Number.isFinite(transport.beltLaneCapacity) ||
    transport.beltLaneCapacity <= 0 ||
    !positiveInteger(transport.undergroundBeltReach) ||
    !positiveInteger(transport.undergroundPipeReach) ||
    transport.fluidThroughput !== 'unlimited' ||
    transport.inserters.length === 0 ||
    transport.inserters.some(
      ({ id, capacity, reach }) =>
        !id.trim() || !Number.isFinite(capacity) || capacity <= 0 || !positiveInteger(reach),
    ) ||
    new Set(transport.inserters.map(({ id }) => id)).size !== transport.inserters.length
  ) {
    return invalid(
      'invalid-rule',
      'Transport rules require positive capacities, reaches, and distinct inserter IDs.',
    );
  }
  if (
    !positiveInteger(envelope.maxWidth) ||
    !positiveInteger(envelope.maxPitch) ||
    !positiveInteger(envelope.maxStates) ||
    envelope.primitives.length === 0 ||
    envelope.primitives.some(
      (primitive) => !['surface', 'underground', 'branch', 'direct-insertion'].includes(primitive),
    ) ||
    !positiveInteger(options.repeatCount ?? 1) ||
    (options.moduleHeight !== undefined && !positiveInteger(options.moduleHeight))
  ) {
    return invalid(
      'invalid-rule',
      'Search bounds, repeat count, and physical height must be positive integers.',
    );
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function invalid(
  code: InvalidTileDesignInput['code'],
  message: string,
  resource?: string,
  machineId?: string,
): InvalidTileDesignInput {
  return {
    kind: 'invalid-input',
    code,
    message,
    ...(resource ? { resource } : {}),
    ...(machineId ? { machineId } : {}),
  };
}
