import { isItem } from '../../types.ts';
import { RATE_EPSILON } from './capacity.ts';
import type { InvalidTileDesignInput, TileDesignOptions, TileDesignInput } from './types.ts';

export function isError<T>(result: T | InvalidTileDesignInput): result is InvalidTileDesignInput {
  return (
    typeof result === 'object' && result !== null && 'success' in result && result.success === false
  );
}

export function validateRate(
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

export function validateOptions(options: TileDesignOptions): InvalidTileDesignInput | undefined {
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

export function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function invalid(
  code: InvalidTileDesignInput['code'],
  message: string,
  resource?: string,
  machineId?: string,
): InvalidTileDesignInput {
  return {
    success: false,
    code,
    message,
    ...(resource ? { resource } : {}),
    ...(machineId ? { machineId } : {}),
  };
}

/** Validate callers of the normalized search API as well as the KernelProblem adapter. */
export function validateSearchInput(input: TileDesignInput): string | undefined {
  const error = validateOptions({
    transport: input.transport,
    envelope: input.envelope,
    repeatCount: input.repeat.count,
    moduleHeight: input.repeat.moduleHeight,
  });
  if (error) return error.message;
  if (!input.machines.length) return 'At least one machine is required.';
  const ids = new Set<string>();
  for (const machine of input.machines) {
    if (
      !machine.id.trim() ||
      ids.has(machine.id) ||
      !positiveInteger(machine.size.width) ||
      !positiveInteger(machine.size.height) ||
      !machine.orientations.length ||
      machine.orientations.some(
        ({ rotation }) => !['north', 'east', 'south', 'west'].includes(rotation),
      )
    )
      return 'Machine IDs, footprints, and orientations must be valid and distinct.';
    ids.add(machine.id);
  }
  for (const flows of [
    ...input.machines.flatMap((machine) => [machine.inputs, machine.outputs]),
    input.boundary.inputs,
    input.boundary.outputs,
  ]) {
    const resources = new Set<string>();
    for (const { resource, rate } of flows.items) {
      if (!isItem(resource) || resources.has(resource) || !Number.isFinite(rate) || rate <= 0)
        return 'Item flows require distinct item IDs and finite positive rates.';
      resources.add(resource);
    }
  }
  const balance = new Map<string, number>();
  const scale = new Map<string, number>();
  for (const [flows, sign] of [
    [input.boundary.inputs.items, 1],
    [input.boundary.outputs.items, -1],
    ...input.machines.flatMap(
      (machine) =>
        [
          [machine.outputs.items, 1],
          [machine.inputs.items, -1],
        ] as const,
    ),
  ] as const) {
    for (const { resource, rate } of flows) {
      balance.set(resource, (balance.get(resource) ?? 0) + sign * rate);
      scale.set(resource, Math.max(scale.get(resource) ?? 1, rate));
    }
  }
  for (const [resource, rate] of balance)
    if (Math.abs(rate) > RATE_EPSILON * scale.get(resource)!)
      return `${resource} does not balance external and machine item flows.`;
}
