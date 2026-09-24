import type {
  AssemblerSpecification,
  KernelProblem,
  KernelFlows,
  ResourceRates,
} from '../kernel-problems.ts';
import type { DesignDirection } from '../design.ts';
import { isFluid, isItem, type ResourceId } from '../../types.ts';
import { entriesOf, keysOf } from '../../ts.ts';
import { makeFluidAccesses } from './fluid-access.ts';
import type {
  BoundaryFlows,
  FluidId,
  ItemFlow,
  TileBoundary,
  TileDesignInputResult,
  TileDesignOptions,
  TileMachine,
  TileMachineOrientation,
} from './types.ts';
import { invalid, isError, positiveInteger, validateOptions, validateRate } from './validation.ts';

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
        if (kind === 'fluid' ? !isFluid(resource) : !isItem(resource)) {
          return invalid(
            'invalid-resource',
            `${resource} must use an ${kind === 'fluid' ? 'fluid:' : 'item:'} resource ID.`,
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
        if (!isFluid(declaration.resource)) {
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
        if (!isItem(resource) && !isFluid(resource)) {
          return invalid(
            'invalid-resource',
            `${resource} must use an item: or fluid: resource ID.`,
            resource,
            id,
          );
        }
      }
    }
  }

  for (const [index, specification] of problem.assemblers.entries()) {
    const id = specification.id ?? `machine-${index + 1}`;
    const inputs = splitMachineFlows(specification.inputPerSecond);
    const outputs = splitMachineFlows(specification.outputPerSecond);
    const fluidAccesses = makeFluidAccesses(specification, id, inputs.fluids, outputs.fluids);
    if (isError(fluidAccesses)) return fluidAccesses;
    machines.push({
      id,
      size: { ...(specification.size ?? { width: 3, height: 3 }) },
      orientations: machineOrientations(specification),
      inputs: {
        items: inputs.items,
        fluids: fluidAccesses
          .filter(({ side }) => side === 'input')
          .map(({ resource, boxIndex, positions }) => ({ resource, boxIndex, positions })),
      },
      outputs: {
        items: outputs.items,
        fluids: fluidAccesses
          .filter(({ side }) => side === 'output')
          .map(({ resource, boxIndex, positions }) => ({ resource, boxIndex, positions })),
      },
    });
  }

  const boundary: TileBoundary = {
    inputs: boundaryFlows(problem.inputs),
    outputs: boundaryFlows(problem.outputs),
  };
  const resources = new Set<ResourceId>([
    ...keysOf(problem.inputs.solids),
    ...keysOf(problem.inputs.fluids),
    ...keysOf(problem.outputs.solids),
    ...keysOf(problem.outputs.fluids),
    ...problem.assemblers.flatMap((machine) => [
      ...keysOf(machine.inputPerSecond),
      ...keysOf(machine.outputPerSecond),
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
    success: true,
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

function splitMachineFlows(rates: ResourceRates): {
  items: ItemFlow[];
  fluids: FluidId[];
} {
  const items: ItemFlow[] = [];
  const fluids: FluidId[] = [];
  for (const [resource, rate] of entriesOf(rates)) {
    if (isFluid(resource)) fluids.push(resource);
    else items.push({ resource, rate });
  }
  items.sort((a, b) => a.resource.localeCompare(b.resource));
  fluids.sort();
  return { items, fluids };
}

function boundaryFlows(flows: KernelFlows): BoundaryFlows {
  return {
    items: entriesOf(flows.solids)
      .flatMap(([resource, rate]) => (isItem(resource) ? [{ resource, rate }] : []))
      .sort((a, b) => a.resource.localeCompare(b.resource)),
    fluids: keysOf(flows.fluids).filter(isFluid).sort(),
  };
}

function boundaryRate(flows: KernelFlows, resource: ResourceId): number {
  return flows.solids[resource] ?? flows.fluids[resource] ?? 0;
}
