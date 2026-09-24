import { fluidBoxResources, type FluidBoxResource } from '../fluid-box-resources.ts';
import type { AssemblerSpecification, KernelProblem, KernelFlows } from '../kernel-problems.ts';
import type { DesignDirection } from '../design.ts';
import type { MachineSize, ResourceId } from '../../types.ts';

export type FlowSide = 'input' | 'output';
export type ResourceKind = 'solid' | 'fluid';

export interface ResourceDemand {
  resource: string;
  kind: ResourceKind;
  rate: number;
}

/** One required connection; positions are alternatives into the same fluid storage. */
export interface FluidRequirement {
  resource: string;
  side: FlowSide;
  positions: { position: { x: number; y: number }; direction: DesignDirection }[];
}

export interface TileMachine {
  id: string;
  size: MachineSize;
  allowedRotations: DesignDirection[];
  inputs: ResourceDemand[];
  outputs: ResourceDemand[];
  fluidRequirements: FluidRequirement[];
}

export interface TileBoundary {
  inputs: ResourceDemand[];
  outputs: ResourceDemand[];
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

  const kinds = new Map<string, ResourceKind>();
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
        if (
          (resource.startsWith('fluid:') && kind !== 'fluid') ||
          (resource.startsWith('item:') && kind !== 'solid')
        ) {
          return invalid(
            'invalid-resource',
            `${resource} has conflicting resource kinds.`,
            resource,
          );
        }
        const prior = kinds.get(resource);
        if (prior && prior !== kind) {
          return invalid(
            'invalid-resource',
            `${resource} is declared as both solid and fluid.`,
            resource,
          );
        }
        kinds.set(resource, kind);
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
    const rotations = specification.allowedRotations ?? directions;
    if (
      rotations.length === 0 ||
      new Set(rotations).size !== rotations.length ||
      rotations.some((rotation) => !directions.includes(rotation))
    ) {
      return invalid(
        'invalid-machine',
        `Machine ${id} has invalid allowed rotations.`,
        undefined,
        id,
      );
    }

    for (const [side, declarations] of [
      ['input', specification.fluidIngredients],
      ['output', specification.fluidProducts],
    ] as const) {
      for (const declaration of declarations ?? []) {
        if (kinds.get(declaration.resource) === 'solid') {
          return invalid(
            'invalid-resource',
            `${declaration.resource} is declared as solid and fluid.`,
            declaration.resource,
            id,
          );
        }
        kinds.set(declaration.resource, 'fluid');
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
    for (const resource of [
      ...Object.keys(specification.inputPerSecond),
      ...Object.keys(specification.outputPerSecond),
    ]) {
      if (resource.startsWith('fluid:')) kinds.set(resource, 'fluid');
      else if (resource.startsWith('item:') && kinds.get(resource) === 'fluid') {
        return invalid(
          'invalid-resource',
          `${resource} has conflicting resource kinds.`,
          resource,
          id,
        );
      }
    }
  }

  for (const [resource, kind] of kinds) {
    if (
      (resource.startsWith('fluid:') && kind !== 'fluid') ||
      (resource.startsWith('item:') && kind !== 'solid')
    ) {
      return invalid('invalid-resource', `${resource} has conflicting resource kinds.`, resource);
    }
  }

  for (const [index, specification] of problem.assemblers.entries()) {
    const id = specification.id ?? `machine-${index + 1}`;
    const inputs = demands(specification.inputPerSecond, kinds, id, 'input');
    if ('kind' in inputs) return inputs;
    const outputs = demands(specification.outputPerSecond, kinds, id, 'output');
    if ('kind' in outputs) return outputs;
    const fluidRequirements = makeFluidRequirements(specification, id, inputs, outputs);
    if ('kind' in fluidRequirements) return fluidRequirements;
    machines.push({
      id,
      size: { ...(specification.size ?? { width: 3, height: 3 }) },
      allowedRotations: [...(specification.allowedRotations ?? directions)],
      inputs,
      outputs,
      fluidRequirements,
    });
  }

  const boundary: TileBoundary = {
    inputs: boundaryDemands(problem.inputs),
    outputs: boundaryDemands(problem.outputs),
  };
  const resources = new Set([
    ...boundary.inputs.map(({ resource }) => resource),
    ...boundary.outputs.map(({ resource }) => resource),
    ...machines.flatMap((machine) =>
      [...machine.inputs, ...machine.outputs].map(({ resource }) => resource),
    ),
  ]);
  for (const resource of [...resources].sort()) {
    const supplied = rateOf(boundary.inputs, resource);
    const produced = machines.reduce((sum, machine) => sum + rateOf(machine.outputs, resource), 0);
    const consumed = machines.reduce((sum, machine) => sum + rateOf(machine.inputs, resource), 0);
    const exported = rateOf(boundary.outputs, resource);
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

function makeFluidRequirements(
  specification: AssemblerSpecification,
  machineId: string,
  inputs: ResourceDemand[],
  outputs: ResourceDemand[],
): FluidRequirement[] | InvalidTileDesignInput {
  const fluidInputs = inputs.filter(({ kind }) => kind === 'fluid');
  const fluidOutputs = outputs.filter(({ kind }) => kind === 'fluid');
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

  // The shared assignment helper expects typed IDs. Synthetic resource names are encoded only here.
  const names = [...new Set([...inputOrder, ...outputOrder].map(({ resource }) => resource))];
  const encoded = new Map(names.map((name, index) => [name, `fluid:tile-${index}` as ResourceId]));
  const decoded = new Map([...encoded].map(([name, code]) => [code, name]));
  const toEncoded = (fluids: FluidBoxResource[]) =>
    fluids.map(({ resource, fluidboxIndex }) => ({
      resource: encoded.get(resource)!,
      fluidboxIndex,
    }));
  const inputAssigned = fluidBoxResources(specification, {
    ingredients: toEncoded(inputOrder),
    products: [],
  });
  const outputAssigned = fluidBoxResources(specification, {
    ingredients: [],
    products: toEncoded(outputOrder),
  });
  const requirements: FluidRequirement[] = [];
  for (const [index, resourceId] of inputAssigned) {
    const other = outputAssigned.get(index);
    if (other && other !== resourceId) {
      return invalid(
        'invalid-fluid',
        `Machine ${machineId} needs incompatible fluids at one position.`,
        decoded.get(resourceId),
        machineId,
      );
    }
  }
  for (const [side, assigned] of [
    ['input', inputAssigned],
    ['output', outputAssigned],
  ] as const) {
    for (const [index, resourceId] of assigned) {
      const resource = decoded.get(resourceId)!;
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
      requirements.push({ resource, side, positions });
    }
  }
  for (const [side, fluids] of [
    ['input', fluidInputs],
    ['output', fluidOutputs],
  ] as const) {
    for (const { resource } of fluids) {
      if (
        !requirements.some(
          (requirement) => requirement.resource === resource && requirement.side === side,
        )
      ) {
        return invalid(
          'invalid-fluid',
          `Machine ${machineId} has no ${side} position for ${resource}.`,
          resource,
          machineId,
        );
      }
    }
  }
  return requirements;
}

function orderedFluids(
  demandsForSide: ResourceDemand[],
  declarations: FluidBoxResource[] | undefined,
  machineId: string,
  side: FlowSide,
): FluidBoxResource[] | InvalidTileDesignInput {
  if (!declarations) {
    if (demandsForSide.length > 1) {
      return invalid(
        'invalid-fluid',
        `Machine ${machineId} needs an explicit ${side} assignment for its multiple fluids.`,
        undefined,
        machineId,
      );
    }
    return demandsForSide.map(({ resource }) => ({ resource: resource as ResourceId }));
  }
  const expected = new Set(demandsForSide.map(({ resource }) => resource));
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

function demands(
  rates: Record<string, number>,
  kinds: Map<string, ResourceKind>,
  machineId: string,
  side: FlowSide,
): ResourceDemand[] | InvalidTileDesignInput {
  const result: ResourceDemand[] = [];
  for (const [resource, rate] of Object.entries(rates)) {
    const error = validateRate(resource, rate, `${side} of machine ${machineId}`);
    if (error) return error;
    result.push({ resource, kind: kinds.get(resource) ?? 'solid', rate });
  }
  return result.sort((a, b) => a.resource.localeCompare(b.resource));
}

function boundaryDemands(flows: KernelFlows): ResourceDemand[] {
  return [
    ...Object.entries(flows.solids).map(([resource, rate]) => ({
      resource,
      rate,
      kind: 'solid' as const,
    })),
    ...Object.entries(flows.fluids).map(([resource, rate]) => ({
      resource,
      rate,
      kind: 'fluid' as const,
    })),
  ].sort((a, b) => a.resource.localeCompare(b.resource));
}

function rateOf(demandsForSide: ResourceDemand[], resource: string): number {
  return demandsForSide.find((demand) => demand.resource === resource)?.rate ?? 0;
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
