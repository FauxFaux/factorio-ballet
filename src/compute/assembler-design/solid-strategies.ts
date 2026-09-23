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

function sideRows(height: number): number[] {
  return [height - 1, ...Array.from({ length: height - 1 }, (_, y) => y)];
}

function outputRows(height: number): number[] {
  const middle = Math.floor(height / 2);
  return [middle, ...Array.from({ length: height }, (_, y) => y).filter((y) => y !== middle)];
}

function wideInputSiteGroups(
  size: { width: number; height: number },
  outputPositions: { x: number; y: number }[],
): InputSite[][] {
  const rightX = 3 + size.width;
  const farWestY = Math.floor(size.height / 2);
  return [
    sideRows(size.height).map((y) => ({
      beltX: 1,
      position: { x: 2, y },
      direction: 'east' as const,
    })),
    sideRows(size.height)
      .filter((y) => !outputPositions.some((position) => position.y === y))
      .map((y) => ({
        beltX: rightX + 1,
        position: { x: rightX, y },
        direction: 'west' as const,
      })),
    [{ beltX: 0, position: { x: 2, y: farWestY }, direction: 'east', reach: 2 }],
  ];
}

export function solveCompactSolidDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput, inputSolids: inputRates, outputSolids: outputRates } = prepared;
  if (prepared.inputFluids.length > 0 || prepared.outputFluids.length > 0) return notApplicable();
  const invalid = validateSolidFlows(problem, inputRates, outputRates, throughput);
  if (invalid) return rejected(invalid);

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  const size = problem.assemblers[0].size ?? { width: 3, height: 3 };
  const compactInputSites: InputSite[] = sideRows(size.height).map((y) => ({
    beltX: 0,
    position: { x: 1, y },
    direction: 'east',
  }));
  const outputPositions = outputRows(size.height).map((y) => ({ x: 2 + size.width, y }));
  const inputInserterCount = Math.ceil(inputRate / throughput.inserterItemsPerSecond);
  const outputInserterCount = Math.ceil(outputRate / throughput.inserterItemsPerSecond);
  if (
    inputRates.length > 2 ||
    inputRate > throughput.beltItemsPerSecond ||
    (inputRates.length === 2 &&
      inputRates.some((rate) => rate > throughput.beltItemsPerSecond / 2)) ||
    inputInserterCount > compactInputSites.length ||
    outputInserterCount > outputPositions.length
  ) {
    return notApplicable();
  }

  const entities: DesignEntity[] = [
    ...verticalBelt(0, 'north', size.height),
    ...compactInputSites.slice(0, inputInserterCount).map(({ position, direction }) => ({
      kind: 'inserter' as const,
      position,
      direction,
    })),
    assembler(problem, 2),
    ...outputPositions.slice(0, outputInserterCount).map((position) => ({
      kind: 'inserter' as const,
      position,
      direction: 'east' as const,
    })),
    ...verticalBelt(3 + size.width, 'south', size.height),
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
  const size = problem.assemblers[0].size ?? { width: 3, height: 3 };
  const outputPositions = outputRows(size.height)
    .slice(0, 2)
    .map((y) => ({ x: 3 + size.width, y }));
  const outputInserterCount = Math.ceil(outputRate / throughput.longInserterItemsPerSecond);
  if (outputInserterCount > outputPositions.length) {
    return rejected(
      inserterFailure(
        'extract',
        Object.keys(problem.outputs.solids),
        problem,
        outputInserterCount,
        outputPositions.length,
      ),
    );
  }

  const selectedInputSites = wideInputSites(
    problem,
    throughput,
    wideInputSiteGroups(size, outputPositions.slice(0, outputInserterCount)),
  );
  if (!Array.isArray(selectedInputSites)) return rejected(selectedInputSites);

  const entities: DesignEntity[] = [
    ...[...new Set(selectedInputSites.map(({ beltX }) => beltX))].flatMap((beltX) =>
      verticalBelt(beltX, 'north', size.height),
    ),
    ...selectedInputSites.map(({ position, direction, reach }) => ({
      kind: 'inserter' as const,
      position,
      direction,
      ...(reach ? { reach } : {}),
    })),
    assembler(problem, 3),
    ...outputPositions.slice(0, outputInserterCount).map((position) => ({
      kind: 'inserter' as const,
      position,
      direction: 'east' as const,
      reach: 2 as const,
    })),
    ...verticalBelt(5 + size.width, 'south', size.height),
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
  siteGroups: InputSite[][],
): InputSite[] | AssemblerDesignRejection {
  const inputEntries = Object.entries(problem.inputs.solids);
  if (inputEntries.length === 1) {
    return splitSingleInputAcrossBelts(problem, inputEntries[0][1], throughput, siteGroups);
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
      currentGroup[0][1] <= throughput.beltItemsPerSecond / 2 &&
      resourceRate <= throughput.beltItemsPerSecond / 2 &&
      sum(currentGroup.map(([, rate]) => rate)) + resourceRate <= throughput.beltItemsPerSecond
    ) {
      currentGroup.push(entry);
    } else {
      beltGroups.push([entry]);
    }
  }

  if (beltGroups.length > siteGroups.length) {
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

    const allSites = siteGroups[beltIndex];
    const sites =
      beltIndex === 0 && beltGroups.length === 3
        ? allSites.filter((site) => site.position.y !== siteGroups[2][0].position.y)
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
  siteGroups: InputSite[][],
): InputSite[] | AssemblerDesignRejection {
  const selected: InputSite[] = [];
  let remaining = rate;

  // A third belt would claim the middle west site for its long inserter. Since long inserters are
  // slower, replacing that site's normal inserter cannot increase single-item transfer capacity.
  for (let beltIndex = 0; beltIndex < 2 && remaining > 0; beltIndex += 1) {
    const sites = siteGroups[beltIndex];
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
