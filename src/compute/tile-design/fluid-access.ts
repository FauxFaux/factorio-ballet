import { fluidBoxResources, type FluidBoxResource } from '../fluid-box-resources.ts';
import type { AssemblerSpecification } from '../kernel-problems.ts';
import type { DesignDirection } from '../design.ts';
import type { FluidAccess, FluidId, InvalidTileDesignInput } from './types.ts';
import { invalid, isError, positiveInteger } from './validation.ts';

type FlowSide = 'input' | 'output';

interface SidedFluidAccess extends FluidAccess {
  side: FlowSide;
}

const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];

export function makeFluidAccesses(
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
  if (isError(inputOrder)) return inputOrder;
  const outputOrder = orderedFluids(fluidOutputs, specification.fluidProducts, machineId, 'output');
  if (isError(outputOrder)) return outputOrder;

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
