import { assemblerProblem } from './kernel-problem.ts';
import type { MachineSize } from '../types.ts';

const FLUID_RATE = 200;

/**
 * Build a fluid-only problem for an air filter whose ports sit at the centres of its north and
 * south faces. Fluid boxes describe physical machine geometry only; they do not assign either
 * synthetic fluid to a recipe fluid-box index.
 */
export function airFilterProblem(size: MachineSize) {
  const northY = -Math.floor(size.height / 2);
  const southY = Math.floor(size.height / 2);

  return assemblerProblem({
    assemblerName: `Air filter ${size.width}×${size.height}`,
    fluidInputs: [FLUID_RATE],
    fluidOutputs: [FLUID_RATE],
    size,
    fluidBoxes: [
      {
        productionType: 'input',
        connections: [
          { position: { x: 0, y: southY }, direction: 'south', flowDirection: 'input' },
        ],
      },
      {
        productionType: 'output',
        connections: [
          { position: { x: 0, y: northY }, direction: 'north', flowDirection: 'output' },
        ],
      },
    ],
  });
}

/** Examples shown in the standalone kernel workspace, grouped by their fluid boundary shape. */
export const kernelProblems = {
  solid: [
    assemblerProblem({ solidInputs: [5], solidOutputs: [2] }),
    assemblerProblem({ solidInputs: [8], solidOutputs: [3] }),
    assemblerProblem({ solidInputs: [25], solidOutputs: [2] }),
    assemblerProblem({ solidInputs: [5, 5], solidOutputs: [2] }),
    assemblerProblem({ solidInputs: [5, 5, 8], solidOutputs: [2] }),
    assemblerProblem({ solidInputs: [5, 5, 5], solidOutputs: [2, 2] }),
  ],
  fluidInput: [
    assemblerProblem({ fluidInputs: [FLUID_RATE], solidOutputs: [2] }),
    assemblerProblem({ solidInputs: [5], fluidInputs: [FLUID_RATE], solidOutputs: [2] }),
    assemblerProblem({ solidInputs: [5, 8], fluidInputs: [FLUID_RATE], solidOutputs: [2] }),
    assemblerProblem({
      solidInputs: [5, 5],
      fluidInputs: [FLUID_RATE],
      solidOutputs: [2, 2],
    }),
  ],
  fluidOutput: [
    assemblerProblem({ solidInputs: [5], fluidOutputs: [FLUID_RATE] }),
    assemblerProblem({ solidInputs: [8], fluidOutputs: [FLUID_RATE] }),
    assemblerProblem({ solidInputs: [25], fluidOutputs: [FLUID_RATE] }),
    assemblerProblem({ solidInputs: [5, 5], fluidOutputs: [FLUID_RATE] }),
    assemblerProblem({ solidInputs: [5, 5, 8], fluidOutputs: [FLUID_RATE] }),
    assemblerProblem({
      solidInputs: [5, 5, 5],
      solidOutputs: [2],
      fluidOutputs: [FLUID_RATE],
    }),
  ],
  fluidInputAndOutput: [
    assemblerProblem({ fluidInputs: [FLUID_RATE], fluidOutputs: [FLUID_RATE] }),
    assemblerProblem({
      solidInputs: [5],
      fluidInputs: [FLUID_RATE],
      fluidOutputs: [FLUID_RATE],
    }),
    assemblerProblem({
      solidInputs: [5, 8],
      fluidInputs: [FLUID_RATE],
      fluidOutputs: [FLUID_RATE],
    }),
    assemblerProblem({
      solidInputs: [5, 5],
      fluidInputs: [FLUID_RATE],
      solidOutputs: [2],
      fluidOutputs: [FLUID_RATE],
    }),
  ],
  airFilter: [
    airFilterProblem({ width: 3, height: 5 }),
    airFilterProblem({ width: 5, height: 3 }),
    airFilterProblem({ width: 5, height: 5 }),
  ],
};

export const allKernelProblems = Object.values(kernelProblems).flat();

export type {
  AssemblerProblemOptions,
  AssemblerSpecification,
  KernelFlows,
  KernelProblem,
  ResourceRates,
} from './kernel-problem.ts';
export { assemblerProblem } from './kernel-problem.ts';
