import { isFluid } from '../../types.ts';
import type { BobProblem, Rates } from './types.ts';

/** Fluid connections are assumed satisfied and consume no space in the Bob experiment. */
export function itemOnlyBobProblem(problem: BobProblem): BobProblem {
  const items = (rates: Rates): Rates =>
    Object.fromEntries(Object.entries(rates).filter(([resource]) => !isFluid(resource)));
  return {
    machines: problem.machines.map((machine) => ({
      ...machine,
      inputs: items(machine.inputs),
      outputs: items(machine.outputs),
    })),
    inputs: problem.inputs.filter((resource) => !isFluid(resource)),
    outputs: problem.outputs.filter((resource) => !isFluid(resource)),
  };
}
