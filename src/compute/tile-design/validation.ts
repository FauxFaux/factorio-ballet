import type { InvalidTileDesignInput, TileDesignOptions } from './types.ts';

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
