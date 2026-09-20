import type { FactoryDesign, DesignEntity } from './design.ts';
import type { KernelProblem, ResourceRates } from './kernel-problems.ts';

/** Transport capabilities selected for one assembler-kernel generation pass. */
export interface AssemblerDesignThroughput {
  beltItemsPerSecond: number;
  inserterItemsPerSecond: number;
  longInserterItemsPerSecond: number;
}

interface InputSite {
  beltX: number;
  position: { x: number; y: number };
  direction: 'east' | 'west';
  reach?: 2;
}

const compactInputSites: InputSite[] = [
  { beltX: 0, position: { x: 1, y: 2 }, direction: 'east' },
  { beltX: 0, position: { x: 1, y: 0 }, direction: 'east' },
];

const compactOutputPositions = [
  { x: 5, y: 1 },
  { x: 5, y: 0 },
];

const longOutputPositions = [
  { x: 6, y: 1 },
  { x: 6, y: 0 },
];

// Ordered so every prefix is the canonical two- or three-input pattern from ASSEMBLERS.md.
const inputSites: InputSite[] = [
  { beltX: 1, position: { x: 2, y: 2 }, direction: 'east' },
  { beltX: 7, position: { x: 6, y: 2 }, direction: 'west' },
  { beltX: 0, position: { x: 2, y: 1 }, direction: 'east', reach: 2 },
];

/**
 * Generate the compact, vertically tileable solid-item design supported by the current model.
 *
 * The model cannot yet describe fluid connections or filtered multi-product output, so those
 * problems deliberately have no solution. This kernel gives each declared solid input its own
 * belt and may add more belts when transfer throughput requires them.
 */
export function generateAssemblerDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): FactoryDesign | undefined {
  if (
    !Number.isFinite(throughput.beltItemsPerSecond) ||
    throughput.beltItemsPerSecond <= 0 ||
    !Number.isFinite(throughput.inserterItemsPerSecond) ||
    throughput.inserterItemsPerSecond <= 0 ||
    !Number.isFinite(throughput.longInserterItemsPerSecond) ||
    throughput.longInserterItemsPerSecond <= 0
  ) {
    return undefined;
  }
  if (problem.assemblers.length !== 1) return undefined;
  if (hasRates(problem.inputs.fluids) || hasRates(problem.outputs.fluids)) return undefined;

  const inputRates = positiveRates(problem.inputs.solids);
  const outputRates = positiveRates(problem.outputs.solids);
  if (!inputRates || !outputRates || inputRates.length > 3 || outputRates.length !== 1) {
    return undefined;
  }

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  if (outputRate > throughput.beltItemsPerSecond) return undefined;

  const compactInputInserterCount = Math.ceil(inputRate / throughput.inserterItemsPerSecond);
  const compactOutputInserterCount = Math.ceil(outputRate / throughput.inserterItemsPerSecond);
  const compact =
    inputRates.length <= 2 &&
    inputRate <= throughput.beltItemsPerSecond &&
    compactInputInserterCount <= compactInputSites.length &&
    compactOutputInserterCount <= compactOutputPositions.length;

  const inputBeltCount = compact
    ? 1
    : [2, 3].find(
        (count) =>
          count >= inputRates.length &&
          inputRate <= count * throughput.beltItemsPerSecond &&
          inputRate <= inputTransferCapacity(count, throughput),
      );
  const outputInserterItemsPerSecond = compact
    ? throughput.inserterItemsPerSecond
    : throughput.longInserterItemsPerSecond;
  const outputInserterCount = Math.ceil(outputRate / outputInserterItemsPerSecond);
  if (!inputBeltCount || outputInserterCount > longOutputPositions.length) return undefined;

  const selectedInputSites = compact
    ? compactInputSites.slice(0, compactInputInserterCount)
    : inputSites.slice(0, inputBeltCount);
  const assemblerX = compact ? 2 : 3;
  const outputBeltX = compact ? 6 : 8;
  const outputPositions = compact ? compactOutputPositions : longOutputPositions;

  const entities: DesignEntity[] = [
    ...[...new Set(selectedInputSites.map(({ beltX }) => beltX))].flatMap((beltX) =>
      verticalBelt(beltX, 'north'),
    ),
    ...selectedInputSites.map(({ position, direction, reach }) => ({
      kind: 'inserter' as const,
      position,
      direction,
      ...(reach ? { reach } : {}),
    })),
    {
      kind: 'assembler',
      position: { x: assemblerX, y: 0 },
      size: { width: 3, height: 3 },
      recipe: problem.assemblers[0].name,
    },
    ...outputPositions.slice(0, outputInserterCount).map((position) => ({
      kind: 'inserter' as const,
      position,
      direction: 'east' as const,
      ...(compact ? {} : { reach: 2 as const }),
    })),
    ...verticalBelt(outputBeltX, 'south'),
  ];

  return { columns: [{ entities }] };
}

function verticalBelt(x: number, direction: 'north' | 'south'): DesignEntity[] {
  return [0, 1, 2].map((y) => ({ kind: 'belt', position: { x, y }, direction }));
}

function inputTransferCapacity(beltCount: number, throughput: AssemblerDesignThroughput): number {
  const normalInserters = Math.min(beltCount, 2);
  const longInserters = Math.max(0, beltCount - normalInserters);
  return (
    normalInserters * throughput.inserterItemsPerSecond +
    longInserters * throughput.longInserterItemsPerSecond
  );
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
