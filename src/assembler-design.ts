import type { FactoryDesign, DesignEntity } from './compute/design.ts';
import type { KernelProblem, ResourceRates } from './compute/kernel-problems.ts';

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

const edgeRows = [2, 0, 1];
const outputRows = [1, 0, 2];

const compactInputSites: InputSite[] = [
  { beltX: 0, position: { x: 1, y: 2 }, direction: 'east' },
  { beltX: 0, position: { x: 1, y: 0 }, direction: 'east' },
  { beltX: 0, position: { x: 1, y: 1 }, direction: 'east' },
];

const compactOutputPositions = [
  { x: 5, y: 1 },
  { x: 5, y: 0 },
  { x: 5, y: 2 },
];

const longOutputPositions = [
  { x: 6, y: 1 },
  { x: 6, y: 0 },
];

// Three normal inserters can read the west near belt when its middle site is not occupied by the
// far-west belt's long inserter. The east middle site belongs to the output inserter.
const wideInputSiteGroups: InputSite[][] = [
  [
    { beltX: 1, position: { x: 2, y: 2 }, direction: 'east' },
    { beltX: 1, position: { x: 2, y: 0 }, direction: 'east' },
    { beltX: 1, position: { x: 2, y: 1 }, direction: 'east' },
  ],
  [
    { beltX: 7, position: { x: 6, y: 2 }, direction: 'west' },
    { beltX: 7, position: { x: 6, y: 0 }, direction: 'west' },
  ],
  [{ beltX: 0, position: { x: 2, y: 1 }, direction: 'east', reach: 2 }],
];

/**
 * Generate a vertically tileable assembler design supported by the current transport kernels.
 *
 * The fluid kernels support one trunk and the solid kernels support one product. Filtered
 * multi-product output and simultaneous fluid input/output deliberately have no solution. Each
 * input belt may carry two solid resources, one per lane, and the kernel adds belts when lane
 * count or transfer throughput requires them.
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
  const hasFluidInput = hasRates(problem.inputs.fluids);
  const hasFluidOutput = hasRates(problem.outputs.fluids);
  if (hasFluidInput && hasFluidOutput) return undefined;
  if (hasFluidInput) {
    return generateFluidInputDesign(problem, throughput);
  }
  if (hasFluidOutput) return generateFluidOutputDesign(problem, throughput);

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
  const outputPositions = compact ? compactOutputPositions : longOutputPositions;
  if (outputInserterCount > outputPositions.length) return undefined;

  const selectedInputSites = compact
    ? compactInputSites.slice(0, compactInputInserterCount)
    : wideInputSites(inputRates, throughput, outputInserterCount);
  if (!selectedInputSites) return undefined;
  const assemblerX = compact ? 2 : 3;
  const outputBeltX = compact ? 6 : 8;

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
    assembler(problem, assemblerX),
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

function generateFluidOutputDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): FactoryDesign | undefined {
  const inputRates = positiveRates(problem.inputs.solids);
  const solidOutputRates = optionalPositiveRates(problem.outputs.solids);
  const fluidOutputRates = positiveRates(problem.outputs.fluids);
  if (
    !inputRates ||
    inputRates.length > 4 ||
    !solidOutputRates ||
    solidOutputRates.length !== 0 ||
    !fluidOutputRates ||
    fluidOutputRates.length !== 1
  ) {
    return undefined;
  }

  const nearInputRate = sum(inputRates.slice(0, 2));
  const farInputRate = sum(inputRates.slice(2, 4));
  if (
    nearInputRate > throughput.beltItemsPerSecond ||
    farInputRate > throughput.beltItemsPerSecond
  ) {
    return undefined;
  }

  const nearInserterCount = Math.ceil(nearInputRate / throughput.inserterItemsPerSecond);
  const farInserterCount = Math.ceil(farInputRate / throughput.longInserterItemsPerSecond);
  if (nearInserterCount + farInserterCount > 3) return undefined;
  const nearInserterYs = edgeRows.slice(0, nearInserterCount);
  const farInserterYs = outputRows
    .filter((y) => !nearInserterYs.includes(y))
    .slice(0, farInserterCount);
  if (farInserterYs.length !== farInserterCount) return undefined;

  const entities: DesignEntity[] = [
    ...pipeTrunk(),
    ...verticalBelt(5, 'north'),
    ...(farInputRate > 0 ? verticalBelt(6, 'north') : []),
    ...nearInserterYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: 4, y },
      direction: 'west',
    })),
    ...farInserterYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: 4, y },
      direction: 'west',
      reach: 2,
    })),
    assembler(problem, 1),
  ];

  return { columns: [{ entities }] };
}

function generateFluidInputDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): FactoryDesign | undefined {
  const fluidInputRates = positiveRates(problem.inputs.fluids);
  const inputRates = optionalPositiveRates(problem.inputs.solids);
  const outputRates = positiveRates(problem.outputs.solids);
  if (
    !fluidInputRates ||
    fluidInputRates.length !== 1 ||
    !inputRates ||
    inputRates.length > 2 ||
    !outputRates ||
    outputRates.length !== 1
  ) {
    return undefined;
  }

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  const hasSolidInput = inputRates.length > 0;
  if (inputRate > throughput.beltItemsPerSecond || outputRate > throughput.beltItemsPerSecond) {
    return undefined;
  }

  const inputInserterCount = Math.ceil(inputRate / throughput.inserterItemsPerSecond);
  const outputItemsPerSecond = hasSolidInput
    ? throughput.longInserterItemsPerSecond
    : throughput.inserterItemsPerSecond;
  const outputInserterCount = Math.ceil(outputRate / outputItemsPerSecond);
  if (inputInserterCount + outputInserterCount > 3) return undefined;

  const inputYs = edgeRows.slice(0, inputInserterCount);
  const outputYs = outputRows.filter((y) => !inputYs.includes(y)).slice(0, outputInserterCount);
  if (outputYs.length !== outputInserterCount) return undefined;

  const outputBeltX = hasSolidInput ? 6 : 5;
  const entities: DesignEntity[] = [
    ...pipeTrunk(),
    ...(hasSolidInput ? verticalBelt(5, 'north') : []),
    ...inputYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: 4, y },
      direction: 'west',
    })),
    assembler(problem, 1),
    ...outputYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: 4, y },
      direction: 'east',
      ...(hasSolidInput ? { reach: 2 } : {}),
    })),
    ...verticalBelt(outputBeltX, 'south'),
  ];

  return { columns: [{ entities }] };
}

function verticalBelt(x: number, direction: 'north' | 'south'): DesignEntity[] {
  return [0, 1, 2].map((y) => ({ kind: 'belt', position: { x, y }, direction }));
}

function pipeTrunk(): DesignEntity[] {
  return [0, 1, 2].map((y) => ({ kind: 'pipe', position: { x: 0, y } }));
}

function assembler(problem: KernelProblem, x: number): DesignEntity {
  return {
    kind: 'assembler',
    position: { x, y: 0 },
    size: { width: 3, height: 3 },
    recipe: problem.assemblers[0].name,
  };
}

function wideInputSites(
  inputRates: number[],
  throughput: AssemblerDesignThroughput,
  outputInserterCount: number,
): InputSite[] | undefined {
  if (inputRates.length === 1) {
    return splitSingleInputAcrossBelts(inputRates[0], throughput, outputInserterCount);
  }

  const beltCount = Math.ceil(inputRates.length / 2);
  if (beltCount < 2 || beltCount > wideInputSiteGroups.length) return undefined;

  const selected: InputSite[] = [];
  for (let beltIndex = 0; beltIndex < beltCount; beltIndex += 1) {
    const rate = sum(inputRates.slice(beltIndex * 2, beltIndex * 2 + 2));
    if (rate > throughput.beltItemsPerSecond) return undefined;

    const allSites = wideInputSiteGroups[beltIndex];
    const sites =
      beltIndex === 0 && beltCount === 3
        ? allSites.slice(0, 2)
        : beltIndex === 1 && outputInserterCount === 2
          ? allSites.slice(0, 1)
          : allSites;
    const itemsPerSecond =
      beltIndex === 2 ? throughput.longInserterItemsPerSecond : throughput.inserterItemsPerSecond;
    const inserterCount = Math.ceil(rate / itemsPerSecond);
    if (inserterCount > sites.length) return undefined;
    selected.push(...sites.slice(0, inserterCount));
  }
  return selected;
}

function splitSingleInputAcrossBelts(
  rate: number,
  throughput: AssemblerDesignThroughput,
  outputInserterCount: number,
): InputSite[] | undefined {
  const selected: InputSite[] = [];
  let remaining = rate;

  // A third belt would claim the middle west site for its long inserter. Since long inserters are
  // slower, replacing that site's normal inserter cannot increase single-item transfer capacity.
  for (let beltIndex = 0; beltIndex < 2 && remaining > 0; beltIndex += 1) {
    const allSites = wideInputSiteGroups[beltIndex];
    const sites = beltIndex === 1 && outputInserterCount === 2 ? allSites.slice(0, 1) : allSites;
    const itemsPerSecond = throughput.inserterItemsPerSecond;
    const beltCapacity = Math.min(throughput.beltItemsPerSecond, sites.length * itemsPerSecond);
    const assignedRate = Math.min(remaining, beltCapacity);
    const inserterCount = Math.ceil(assignedRate / itemsPerSecond);
    selected.push(...sites.slice(0, inserterCount));
    remaining -= assignedRate;
  }

  return remaining <= Number.EPSILON ? selected : undefined;
}

function positiveRates(rates: ResourceRates): number[] | undefined {
  const values = Object.values(rates);
  return values.length > 0 && values.every((rate) => Number.isFinite(rate) && rate > 0)
    ? values
    : undefined;
}

function optionalPositiveRates(rates: ResourceRates): number[] | undefined {
  const values = Object.values(rates);
  return values.every((rate) => Number.isFinite(rate) && rate > 0) ? values : undefined;
}

function hasRates(rates: ResourceRates): boolean {
  return Object.values(rates).some((rate) => rate !== 0);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
