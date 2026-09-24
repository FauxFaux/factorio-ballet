import type { AssemblerSpecification, KernelProblem, KernelFlows } from '../kernel-problems.ts';
import type { DesignDirection } from '../design.ts';
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
import { invalid, positiveInteger, validateOptions, validateRate } from './validation.ts';

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
