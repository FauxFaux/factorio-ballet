import { newFactoryDesign, type FactoryDesign } from './design.ts';
import type { MachineFluidBox, MachineSize } from '../types.ts';

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
  /** The machine's tile footprint when a problem needs non-default geometry. */
  size?: MachineSize;
  /** Physical fluid slots and ports; recipe-fluid assignment is intentionally separate. */
  fluidBoxes?: MachineFluidBox[];
}

/** A factory-kernel task, including its boundary contract and the machines it must contain. */
export interface KernelProblem {
  inputs: KernelFlows;
  outputs: KernelFlows;
  assemblers: AssemblerSpecification[];
  design: FactoryDesign;
}

export interface AssemblerProblemOptions {
  assemblerName?: string;
  solidInputs?: readonly number[];
  fluidInputs?: readonly number[];
  solidOutputs?: readonly number[];
  fluidOutputs?: readonly number[];
  size?: MachineSize;
  fluidBoxes?: MachineFluidBox[];
}

/** Build a one-assembler problem with distinct synthetic resources for each flow. */
export function assemblerProblem({
  assemblerName,
  solidInputs = [],
  fluidInputs = [],
  solidOutputs = [],
  fluidOutputs = [],
  size,
  fluidBoxes,
}: AssemblerProblemOptions): KernelProblem {
  const useAssembler2 =
    assemblerName === undefined && (fluidInputs.length > 0 || fluidOutputs.length > 0);
  const inputs: KernelFlows = {
    solids: resourceRates('item', solidInputs),
    fluids: resourceRates('fluid', fluidInputs),
  };
  const outputs: KernelFlows = {
    solids: resourceRates('item', solidOutputs, solidInputs.length + 1),
    fluids: resourceRates('fluid', fluidOutputs, fluidInputs.length + 1),
  };

  return {
    inputs,
    outputs,
    assemblers: [
      {
        name: assemblerName ?? (useAssembler2 ? 'Assembler 2' : 'Assembler 1'),
        inputPerSecond: { ...inputs.solids, ...inputs.fluids },
        outputPerSecond: { ...outputs.solids, ...outputs.fluids },
        ...(size ? { size } : useAssembler2 ? { size: { width: 3, height: 3 } } : {}),
        ...(fluidBoxes
          ? { fluidBoxes }
          : useAssembler2
            ? { fluidBoxes: assemblingMachine2FluidBoxes() }
            : {}),
      },
    ],
    design: newFactoryDesign(),
  };
}

/** Fluid geometry of the `assembling-machine-2` prototype in the generated static data. */
function assemblingMachine2FluidBoxes(): MachineFluidBox[] {
  return [
    {
      productionType: 'input',
      connections: [{ position: { x: 0, y: -1 }, direction: 'north', flowDirection: 'input' }],
    },
    {
      productionType: 'output',
      connections: [{ position: { x: 0, y: 1 }, direction: 'south', flowDirection: 'output' }],
    },
  ];
}

function resourceRates(prefix: string, rates: readonly number[], startIndex = 1): ResourceRates {
  return Object.fromEntries(rates.map((rate, index) => [`${prefix} ${startIndex + index}`, rate]));
}
