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

/** Starter tasks for the standalone kernel workspace. */
export const kernelProblems: KernelProblem[] = [
  {
    name: 'Problem 1',
    inputs: {
      solids: { 'item 1': 5, 'item 2': 1 },
      fluids: { 'fluid 3': 200 },
    },
    outputs: { solids: { 'item 4': 2 }, fluids: {} },
    assemblers: [
      {
        name: 'Assembler 1',
        inputPerSecond: { 'item 1': 5, 'item 2': 1, 'fluid 3': 200 },
        outputPerSecond: { 'item 4': 2 },
      },
    ],
    design: newFactoryDesign(),
  },
  {
    name: 'Problem 2',
    inputs: {
      solids: { 'item 1': 3 },
      fluids: { 'fluid 1': 40 },
    },
    outputs: { solids: { 'item 2': 1 }, fluids: { 'fluid 2': 10 } },
    assemblers: [
      {
        name: 'Assembler 1',
        inputPerSecond: { 'item 1': 3, 'fluid 1': 40 },
        outputPerSecond: { 'item 2': 1, 'fluid 2': 10 },
      },
    ],
    design: newFactoryDesign(),
  },
  {
    name: 'Problem 3',
    inputs: {
      solids: { 'item 1': 1, 'item 2': 2 },
      fluids: {},
    },
    outputs: { solids: { 'item 3': 1 }, fluids: {} },
    assemblers: [
      {
        name: 'Assembler 1',
        inputPerSecond: { 'item 1': 1, 'item 2': 2 },
        outputPerSecond: { 'item 3': 1 },
      },
    ],
    design: newFactoryDesign(),
  },
];
