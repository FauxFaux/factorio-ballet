import { newFactoryDesign, type FactoryDesign } from './design.ts';
import { staticData } from '../data/decode.ts';
import type { FluidBoxResource } from './fluid-box-resources.ts';
import type { MachineFluidBox, MachineSize } from '../types.ts';

const FLUID_RATE = 200;

/** Rates for the resources crossing one side of a kernel boundary. */
export type ResourceRates = Record<string, number>;

/** The solid belts and fluid pipes a kernel consumes or produces. */
export interface KernelFlows {
  solids: ResourceRates;
  fluids: ResourceRates;
}

/** One machine's required recipe inputs and outputs, at its intended running rate. */
export interface AssemblerSpecification {
  /** Stable identity within a kernel, independent of the machine's name. */
  id?: string;
  name: string;
  inputPerSecond: ResourceRates;
  outputPerSecond: ResourceRates;
  /** The machine's tile footprint when a problem needs non-default geometry. */
  size?: MachineSize;
  /** Physical fluid slots and ports; recipe-fluid assignment is intentionally separate. */
  fluidBoxes?: MachineFluidBox[];
  /** Recipe order and explicit input-box indexes, when available. */
  fluidIngredients?: FluidBoxResource[];
  /** Product order and explicit output-box indexes, when available. */
  fluidProducts?: FluidBoxResource[];
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
    assemblerName === 'Assembler 2' ||
    (assemblerName === undefined && (fluidInputs.length > 0 || fluidOutputs.length > 0));
  const inputs: KernelFlows = {
    solids: resourceRates('item ', solidInputs),
    fluids: resourceRates('fluid:', fluidInputs),
  };
  const outputs: KernelFlows = {
    solids: resourceRates('item ', solidOutputs, solidInputs.length + 1),
    fluids: resourceRates('fluid:', fluidOutputs, fluidInputs.length + 1),
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

export const kernelMachineChoices = [
  { value: 'chemical-plant', label: 'Chemical plant', machineId: 'chemical-plant' },
  { value: 'flare-stack', label: 'Flare stack', machineId: 'angels-flare-stack' },
  { value: 'casting-machine', label: 'Casting machine', machineId: 'angels-casting-machine-3' },
  { value: 'powderiser', label: 'Powderiser', machineId: 'angels-powderizer-3' },
] as const;

export type KernelMachineChoice = (typeof kernelMachineChoices)[number]['value'];

/** Give a synthetic flow problem the footprint and fluid ports of a real machine. */
export function machineProblem(
  building: KernelMachineChoice,
  options: Omit<AssemblerProblemOptions, 'assemblerName' | 'size' | 'fluidBoxes'>,
  name?: string,
): KernelProblem {
  const choice = kernelMachineChoices.find(({ value }) => value === building)!;
  const machine = staticData.machines[choice.machineId];
  return assemblerProblem({
    ...options,
    assemblerName: name ?? choice.label,
    size: machine.size,
    fluidBoxes: machine.fluidBoxes,
  });
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
  return Object.fromEntries(rates.map((rate, index) => [`${prefix}${startIndex + index}`, rate]));
}

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
    assemblerProblem({ solidInputs: [30, 5], solidOutputs: [3] }),
    machineProblem('powderiser', { solidInputs: [15], solidOutputs: [15] }, 'Silicon powder'),
    machineProblem('powderiser', { solidInputs: [1, 1], solidOutputs: [1, 1] }, '2×2 solid flows'),
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
    machineProblem('flare-stack', { fluidInputs: [400] }, 'Oxygen flare'),
    machineProblem(
      'casting-machine',
      { fluidInputs: [FLUID_RATE, FLUID_RATE], solidOutputs: [2] },
      'Mono-silicon',
    ),
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
    assemblerProblem({ fluidOutputs: [FLUID_RATE] }),
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
    machineProblem(
      'chemical-plant',
      { fluidInputs: [FLUID_RATE], fluidOutputs: [FLUID_RATE, FLUID_RATE] },
      'Air separation',
    ),
  ],
  airFilter: [
    airFilterProblem({ width: 3, height: 5 }),
    airFilterProblem({ width: 5, height: 3 }),
    airFilterProblem({ width: 5, height: 5 }),
  ],
};

export const allKernelProblems = Object.values(kernelProblems).flat();
