import type { FactoryDesign, DesignEntity } from './design.ts';
import type { KernelProblem, ResourceRates } from './kernel-problems.ts';

/** Transport capabilities selected for one assembler-kernel generation pass. */
export interface AssemblerDesignThroughput {
  beltItemsPerSecond: number;
  inserterItemsPerSecond: number;
}

const maximumInputInserters = 2;
const maximumOutputInserters = 1;

/**
 * Generate the compact, vertically tileable solid-item design supported by the current model.
 *
 * The model cannot yet describe fluid connections, lane routing, or filtered multi-product
 * output, so those problems deliberately have no solution. A single input belt can carry at most
 * two solid resources, one on each lane.
 */
export function generateAssemblerDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): FactoryDesign | undefined {
  if (
    !Number.isFinite(throughput.beltItemsPerSecond) ||
    throughput.beltItemsPerSecond <= 0 ||
    !Number.isFinite(throughput.inserterItemsPerSecond) ||
    throughput.inserterItemsPerSecond <= 0
  ) {
    return undefined;
  }
  if (problem.assemblers.length !== 1) return undefined;
  if (hasRates(problem.inputs.fluids) || hasRates(problem.outputs.fluids)) return undefined;

  const inputRates = positiveRates(problem.inputs.solids);
  const outputRates = positiveRates(problem.outputs.solids);
  if (!inputRates || !outputRates || inputRates.length > 2 || outputRates.length !== 1) {
    return undefined;
  }

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  if (inputRate > throughput.beltItemsPerSecond || outputRate > throughput.beltItemsPerSecond) {
    return undefined;
  }

  const inputInserters = requiredInserters(inputRate, throughput.inserterItemsPerSecond);
  const outputInserters = requiredInserters(outputRate, throughput.inserterItemsPerSecond);
  if (inputInserters > maximumInputInserters || outputInserters > maximumOutputInserters) {
    return undefined;
  }

  const entities: DesignEntity[] = [
    ...verticalBelt(0, 'north'),
    ...inputInserterPositions.slice(0, inputInserters).map((position) => ({
      kind: 'inserter' as const,
      position,
      direction: 'east' as const,
    })),
    {
      kind: 'assembler',
      position: { x: 2, y: 0 },
      size: { width: 3, height: 3 },
      recipe: problem.assemblers[0].name,
    },
    {
      kind: 'inserter',
      position: { x: 5, y: 1 },
      direction: 'east',
    },
    ...verticalBelt(6, 'south'),
  ];

  return { columns: [{ entities }] };
}

const inputInserterPositions = [
  { x: 1, y: 0 },
  { x: 1, y: 2 },
];

function verticalBelt(x: number, direction: 'north' | 'south'): DesignEntity[] {
  return [0, 1, 2].map((y) => ({ kind: 'belt', position: { x, y }, direction }));
}

function requiredInserters(itemsPerSecond: number, inserterItemsPerSecond: number): number {
  return Math.ceil(itemsPerSecond / inserterItemsPerSecond);
}

function positiveRates(rates: ResourceRates): number[] | undefined {
  const values = Object.values(rates);
  return values.length > 0 && values.every((rate) => Number.isFinite(rate) && rate > 0)
    ? values
    : undefined;
}

function hasRates(rates: ResourceRates): boolean {
  return Object.values(rates).some((rate) => rate !== 0);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
