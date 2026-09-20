import { newFactoryDesign, type FactoryDesign } from './design.ts';
/** Rates for the resources crossing one side of a kernel boundary. */
export type ResourceRates = Record<string, number>;

/** The solid belts and fluid pipes a kernel consumes or produces. */
export interface KernelFlows {
  solids: ResourceRates;
  fluids: ResourceRates;
}

/** One machine's required recipe inputs and outputs, at its intended running rate. */
export interface AssemblerSpecification {
  name: string;
  inputPerSecond: ResourceRates;
  outputPerSecond: ResourceRates;
}

/** A factory-kernel task, including its boundary contract and the machines it must contain. */
export interface KernelProblem {
  name: string;
  inputs: KernelFlows;
  outputs: KernelFlows;
  assemblers: AssemblerSpecification[];
  design: FactoryDesign;
}

interface ProblemShape {
  inputs: number[];
  outputs: number[];
}

interface ResourceMix {
  fluidInput: boolean;
  fluidOutput: boolean;
}

const problemShapes: ProblemShape[] = [
  { inputs: [5], outputs: [2] },
  { inputs: [10], outputs: [3] },
  { inputs: [25], outputs: [3] },
  { inputs: [5, 5], outputs: [2] },
  { inputs: [5, 5, 5], outputs: [2] },
  { inputs: [5, 5, 5], outputs: [2, 2] },
];

const resourceMixes: ResourceMix[] = [
  { fluidInput: false, fluidOutput: false },
  { fluidInput: true, fluidOutput: false },
  { fluidInput: false, fluidOutput: true },
  { fluidInput: true, fluidOutput: true },
];

const FLUID_RATE = 200;

function resourceRates(prefix: string, rates: number[], startIndex = 1): ResourceRates {
  return Object.fromEntries(rates.map((rate, index) => [`${prefix} ${startIndex + index}`, rate]));
}

function makeProblem(shape: ProblemShape, mix: ResourceMix, problemIndex: number): KernelProblem {
  const solidInputRates = mix.fluidInput ? shape.inputs.slice(1) : shape.inputs;
  const fluidInputRates = mix.fluidInput ? [FLUID_RATE] : [];
  const solidOutputRates = mix.fluidOutput ? shape.outputs.slice(1) : shape.outputs;
  const fluidOutputRates = mix.fluidOutput ? [FLUID_RATE] : [];
  const inputs: KernelFlows = {
    solids: resourceRates('item', solidInputRates),
    fluids: resourceRates('fluid', fluidInputRates),
  };
  const outputs: KernelFlows = {
    solids: resourceRates('item', solidOutputRates, solidInputRates.length + 1),
    fluids: resourceRates('fluid', fluidOutputRates, fluidInputRates.length + 1),
  };

  return {
    name: `Problem ${problemIndex + 1}`,
    inputs,
    outputs,
    assemblers: [
      {
        name: 'Assembler 1',
        inputPerSecond: { ...inputs.solids, ...inputs.fluids },
        outputPerSecond: { ...outputs.solids, ...outputs.fluids },
      },
    ],
    design: newFactoryDesign(),
  };
}

/** Starter tasks for the standalone kernel workspace, ordered by increasing complexity. */
export const kernelProblems: KernelProblem[] = resourceMixes
  .flatMap((mix) =>
    (mix.fluidInput
      ? problemShapes.filter((_, index) => index !== 1 && index !== 2)
      : problemShapes
    ).map((shape) => ({ shape, mix })),
  )
  .map(({ shape, mix }, problemIndex) => makeProblem(shape, mix, problemIndex));
