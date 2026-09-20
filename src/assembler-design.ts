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

// Two normal inserters can read each near belt; the far-west belt has one long inserter site.
const wideInputSiteGroups: InputSite[][] = [
  [
    { beltX: 1, position: { x: 2, y: 2 }, direction: 'east' },
    { beltX: 1, position: { x: 2, y: 0 }, direction: 'east' },
  ],
  [
    { beltX: 7, position: { x: 6, y: 2 }, direction: 'west' },
    { beltX: 7, position: { x: 6, y: 0 }, direction: 'west' },
  ],
  [{ beltX: 0, position: { x: 2, y: 1 }, direction: 'east', reach: 2 }],
];

/**
 * Generate the compact, vertically tileable solid-item design supported by the current model.
 *
 * The model cannot yet describe fluid connections or filtered multi-product output, so those
 * problems deliberately have no solution. Each input belt may carry two solid resources, one per
 * lane, and the kernel adds belts when lane count or transfer throughput requires them.
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
  if (!inputRates || !outputRates || inputRates.length > 6 || outputRates.length !== 1) {
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

  const outputInserterItemsPerSecond = compact
    ? throughput.inserterItemsPerSecond
    : throughput.longInserterItemsPerSecond;
  const outputInserterCount = Math.ceil(outputRate / outputInserterItemsPerSecond);
  if (outputInserterCount > longOutputPositions.length) return undefined;

  const selectedInputSites = compact
    ? compactInputSites.slice(0, compactInputInserterCount)
    : wideInputSites(inputRates, throughput, outputInserterCount);
  if (!selectedInputSites) return undefined;
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

function wideInputSites(
  inputRates: number[],
  throughput: AssemblerDesignThroughput,
  outputInserterCount: number,
): InputSite[] | undefined {
  const beltCount = Math.ceil(inputRates.length / 2);
  if (beltCount < 2 || beltCount > wideInputSiteGroups.length) return undefined;

  const selected: InputSite[] = [];
  for (let beltIndex = 0; beltIndex < beltCount; beltIndex += 1) {
    const rate = sum(inputRates.slice(beltIndex * 2, beltIndex * 2 + 2));
    if (rate > throughput.beltItemsPerSecond) return undefined;

    const allSites = wideInputSiteGroups[beltIndex];
    const sites = beltIndex === 1 && outputInserterCount === 2 ? allSites.slice(0, 1) : allSites;
    const itemsPerSecond =
      beltIndex === 2 ? throughput.longInserterItemsPerSecond : throughput.inserterItemsPerSecond;
    const inserterCount = Math.ceil(rate / itemsPerSecond);
    if (inserterCount > sites.length) return undefined;
    selected.push(...sites.slice(0, inserterCount));
  }
  return selected;
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
