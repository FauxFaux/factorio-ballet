import type { DesignEntity } from '../design.ts';
import type { KernelProblem } from '../kernel-problems.ts';
import {
  assembler,
  count,
  designRejection,
  inserterFailure,
  invalidRatesRejection,
  notApplicable,
  rateText,
  reject,
  rejected,
  solved,
  sum,
  verticalBelt,
  type AssemblerDesignThroughput,
  type AssemblerDesignRejection,
  type AssemblerDesignStrategyResult,
  type PreparedAssemblerProblem,
} from './strategy.ts';

interface InputSite {
  beltX: number;
  position: { x: number; y: number };
  direction: 'east' | 'west';
  reach?: 2;
}

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

export function solveCompactSolidDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput, inputSolids: inputRates, outputSolids: outputRates } = prepared;
  if (prepared.inputFluids.length > 0 || prepared.outputFluids.length > 0) return notApplicable();
  const invalid = validateSolidFlows(problem, inputRates, outputRates, throughput);
  if (invalid) return rejected(invalid);

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  const inputInserterCount = Math.ceil(inputRate / throughput.inserterItemsPerSecond);
  const outputInserterCount = Math.ceil(outputRate / throughput.inserterItemsPerSecond);
  if (
    inputRates.length > 2 ||
    inputRate > throughput.beltItemsPerSecond ||
    inputInserterCount > compactInputSites.length ||
    outputInserterCount > compactOutputPositions.length
  ) {
    return notApplicable();
  }

  const entities: DesignEntity[] = [
    ...verticalBelt(0, 'north'),
    ...compactInputSites.slice(0, inputInserterCount).map(({ position, direction }) => ({
      kind: 'inserter' as const,
      position,
      direction,
    })),
    assembler(problem, 2),
    ...compactOutputPositions.slice(0, outputInserterCount).map((position) => ({
      kind: 'inserter' as const,
      position,
      direction: 'east' as const,
    })),
    ...verticalBelt(6, 'south'),
  ];
  return solved({ columns: [{ entities }] });
}

export function solveWideSolidDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput, inputSolids: inputRates, outputSolids: outputRates } = prepared;
  if (prepared.inputFluids.length > 0 || prepared.outputFluids.length > 0) return notApplicable();
  const invalid = validateSolidFlows(problem, inputRates, outputRates, throughput);
  if (invalid) return rejected(invalid);

  if (inputRates.length > 6) {
    return reject(
      'unsupported-flows',
      'cannot insert into',
      problem.assemblers[0].name,
      'because',
      count(inputRates.length, 'solid input'),
      'need',
      count(Math.ceil(inputRates.length / 2), 'belt'),
      'but only 3 belts fit',
    );
  }

  const outputRate = sum(outputRates);
  const outputInserterCount = Math.ceil(outputRate / throughput.longInserterItemsPerSecond);
  if (outputInserterCount > longOutputPositions.length) {
    return rejected(
      inserterFailure(
        'extract',
        Object.keys(problem.outputs.solids),
        problem,
        outputInserterCount,
        longOutputPositions.length,
      ),
    );
  }

  const selectedInputSites = wideInputSites(problem, throughput, outputInserterCount);
  if (!Array.isArray(selectedInputSites)) return rejected(selectedInputSites);

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
    assembler(problem, 3),
    ...longOutputPositions.slice(0, outputInserterCount).map((position) => ({
      kind: 'inserter' as const,
      position,
      direction: 'east' as const,
      reach: 2 as const,
    })),
    ...verticalBelt(8, 'south'),
  ];

  return solved({ columns: [{ entities }] });
}

function validateSolidFlows(
  problem: KernelProblem,
  inputRates: number[],
  outputRates: number[],
  throughput: AssemblerDesignThroughput,
): AssemblerDesignRejection | undefined {
  if (inputRates.length === 0) return invalidRatesRejection('input', problem.inputs.solids);
  if (outputRates.length === 0) return invalidRatesRejection('output', problem.outputs.solids);
  if (outputRates.length !== 1) {
    return designRejection(
      'unsupported-flows',
      'cannot extract from',
      problem.assemblers[0].name,
      'because this generator supports exactly one solid output, not',
      String(outputRates.length),
    );
  }

  const outputRate = sum(outputRates);
  if (outputRate > throughput.beltItemsPerSecond) {
    return designRejection(
      'transport-capacity',
      'cannot output',
      Object.keys(problem.outputs.solids)[0],
      'from',
      problem.assemblers[0].name,
      'because its',
      rateText(outputRate),
      "rate exceeds one belt's",
      rateText(throughput.beltItemsPerSecond),
      'capacity',
    );
  }
  return undefined;
}

function wideInputSites(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
  outputInserterCount: number,
): InputSite[] | AssemblerDesignRejection {
  const inputEntries = Object.entries(problem.inputs.solids);
  if (inputEntries.length === 1) {
    return splitSingleInputAcrossBelts(
      problem,
      inputEntries[0][1],
      throughput,
      outputInserterCount,
    );
  }

  const beltGroups: Array<Array<[string, number]>> = [];
  for (const entry of inputEntries) {
    const [resource, resourceRate] = entry;
    if (resourceRate > throughput.beltItemsPerSecond) {
      return designRejection(
        'transport-capacity',
        'cannot carry',
        resource,
        'because its',
        rateText(resourceRate),
        "rate exceeds one belt's",
        rateText(throughput.beltItemsPerSecond),
        'capacity',
      );
    }

    const currentGroup = beltGroups.at(-1);
    if (
      currentGroup &&
      currentGroup.length < 2 &&
      sum(currentGroup.map(([, rate]) => rate)) + resourceRate <= throughput.beltItemsPerSecond
    ) {
      currentGroup.push(entry);
    } else {
      beltGroups.push([entry]);
    }
  }

  if (beltGroups.length > wideInputSiteGroups.length) {
    return designRejection(
      'entity-placement',
      'cannot fit',
      count(beltGroups.length, 'input belt'),
      'around the assembler because only 3 belt positions are available',
    );
  }

  const selected: InputSite[] = [];
  for (const [beltIndex, group] of beltGroups.entries()) {
    const rate = sum(group.map(([, resourceRate]) => resourceRate));
    const resources = group.map(([resource]) => resource);

    const allSites = wideInputSiteGroups[beltIndex];
    const sites =
      beltIndex === 0 && beltGroups.length === 3
        ? allSites.slice(0, 2)
        : beltIndex === 1 && outputInserterCount === 2
          ? allSites.slice(0, 1)
          : allSites;
    const itemsPerSecond =
      beltIndex === 2 ? throughput.longInserterItemsPerSecond : throughput.inserterItemsPerSecond;
    const inserterCount = Math.ceil(rate / itemsPerSecond);
    if (inserterCount > sites.length) {
      return inserterFailure('insert', resources, problem, inserterCount, sites.length);
    }
    selected.push(...sites.slice(0, inserterCount));
  }
  return selected;
}

function splitSingleInputAcrossBelts(
  problem: KernelProblem,
  rate: number,
  throughput: AssemblerDesignThroughput,
  outputInserterCount: number,
): InputSite[] | AssemblerDesignRejection {
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

  if (remaining <= Number.EPSILON) return selected;

  return inserterFailure(
    'insert',
    Object.keys(problem.inputs.solids),
    problem,
    Math.ceil(rate / throughput.inserterItemsPerSecond),
    selected.length,
  );
}
