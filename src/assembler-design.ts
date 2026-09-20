import type { FactoryDesign, DesignEntity } from './design.ts';
import type { KernelProblem, ResourceRates } from './kernel-problems.ts';

/** Fixed transport capabilities used by the first assembler-kernel generator. */
export const ASSEMBLER_DESIGN_BELT_ITEMS_PER_SECOND = 30;
export const ASSEMBLER_DESIGN_INSERTER_ITEMS_PER_SECOND = 8;

const maximumInputInserters = 2;
const maximumOutputInserters = 1;

/**
 * Generate the compact, vertically tileable solid-item design supported by the current model.
 *
 * The model cannot yet describe fluid connections, lane routing, or filtered multi-product
 * output, so those problems deliberately have no solution. A single input belt can carry at most
 * two solid resources, one on each lane.
 */
export function generateAssemblerDesign(problem: KernelProblem): FactoryDesign | undefined {
  if (problem.assemblers.length !== 1) return undefined;
  if (hasRates(problem.inputs.fluids) || hasRates(problem.outputs.fluids)) return undefined;

  const inputRates = positiveRates(problem.inputs.solids);
  const outputRates = positiveRates(problem.outputs.solids);
  if (!inputRates || !outputRates || inputRates.length > 2 || outputRates.length !== 1) {
    return undefined;
  }

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  if (
    inputRate > ASSEMBLER_DESIGN_BELT_ITEMS_PER_SECOND ||
    outputRate > ASSEMBLER_DESIGN_BELT_ITEMS_PER_SECOND
  ) {
    return undefined;
  }

  const inputInserters = requiredInserters(inputRate);
  const outputInserters = requiredInserters(outputRate);
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

function requiredInserters(itemsPerSecond: number): number {
  return Math.ceil(itemsPerSecond / ASSEMBLER_DESIGN_INSERTER_ITEMS_PER_SECOND);
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
