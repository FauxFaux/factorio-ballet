import { assemblerProblem } from './kernel-problem.ts';

const FLUID_RATE = 200;

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
