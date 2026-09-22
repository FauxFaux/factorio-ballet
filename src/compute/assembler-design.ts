import type { DesignDirection, FactoryDesign, DesignEntity } from './design.ts';
import type { KernelProblem, ResourceRates } from './kernel-problems.ts';

/** Transport capabilities selected for one assembler-kernel generation pass. */
export interface AssemblerDesignThroughput {
  beltItemsPerSecond: number;
  inserterItemsPerSecond: number;
  longInserterItemsPerSecond: number;
}

/** An explanation of the first constraint which prevented a kernel from being generated. */
export interface AssemblerDesignFailure {
  failure: string[];
  columns?: undefined;
}

export type AssemblerDesignResult = FactoryDesign | AssemblerDesignFailure;

export function isAssemblerDesignFailure(
  result: AssemblerDesignResult,
): result is AssemblerDesignFailure {
  return result.columns === undefined;
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
 * The ordinary fluid kernels support one trunk, while machines with suitable opposing ports can
 * connect a fluid input and output to separate trunks. The solid kernels support one product.
 * Each input belt may carry two solid resources, one per lane, and the kernel adds belts when lane
 * count or transfer throughput requires them.
 */
export function generateAssemblerDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): AssemblerDesignResult {
  if (
    !Number.isFinite(throughput.beltItemsPerSecond) ||
    throughput.beltItemsPerSecond <= 0 ||
    !Number.isFinite(throughput.inserterItemsPerSecond) ||
    throughput.inserterItemsPerSecond <= 0 ||
    !Number.isFinite(throughput.longInserterItemsPerSecond) ||
    throughput.longInserterItemsPerSecond <= 0
  ) {
    return failed('cannot design an assembler kernel because transport throughput is invalid');
  }
  if (problem.assemblers.length !== 1) {
    return failed(
      'cannot design a kernel for',
      count(problem.assemblers.length, 'assembler'),
      'because this generator supports exactly one assembler',
    );
  }
  const hasFluidInput = hasRates(problem.inputs.fluids);
  const hasFluidOutput = hasRates(problem.outputs.fluids);
  if (hasFluidInput && hasFluidOutput) return generateDualFluidDesign(problem);
  if (hasFluidInput) {
    return generateFluidInputDesign(problem, throughput);
  }
  if (hasFluidOutput) return generateFluidOutputDesign(problem, throughput);

  const inputRates = positiveRates(problem.inputs.solids);
  const outputRates = positiveRates(problem.outputs.solids);
  if (!inputRates) return invalidRates('input', problem.inputs.solids);
  if (!outputRates) return invalidRates('output', problem.outputs.solids);
  if (inputRates.length > 6) {
    return failed(
      'cannot insert into',
      problem.assemblers[0].name,
      'because',
      count(inputRates.length, 'solid input'),
      'need',
      count(Math.ceil(inputRates.length / 2), 'belt'),
      'but only 3 belts fit',
    );
  }
  if (outputRates.length !== 1) {
    return failed(
      'cannot extract from',
      problem.assemblers[0].name,
      'because this generator supports exactly one solid output, not',
      String(outputRates.length),
    );
  }

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  if (outputRate > throughput.beltItemsPerSecond) {
    return failed(
      'cannot output',
      Object.keys(problem.outputs.solids)[0],
      'from',
      problem.assemblers[0].name,
      'because its',
      rate(outputRate),
      "rate exceeds one belt's",
      rate(throughput.beltItemsPerSecond),
      'capacity',
    );
  }

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
  if (outputInserterCount > outputPositions.length) {
    return inserterFailure(
      'extract',
      Object.keys(problem.outputs.solids),
      problem,
      outputInserterCount,
      outputPositions.length,
    );
  }

  const selectedInputSites = compact
    ? compactInputSites.slice(0, compactInputInserterCount)
    : wideInputSites(problem, throughput, outputInserterCount);
  if (!Array.isArray(selectedInputSites)) return selectedInputSites;
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

function generateDualFluidDesign(problem: KernelProblem): AssemblerDesignResult {
  const specification = problem.assemblers[0];
  const fluidInputs = positiveRates(problem.inputs.fluids);
  const fluidOutputs = positiveRates(problem.outputs.fluids);
  const solidInputs = optionalPositiveRates(problem.inputs.solids);
  const solidOutputs = optionalPositiveRates(problem.outputs.solids);
  if (fluidInputs?.length !== 1 || fluidOutputs?.length !== 1) {
    return failed('cannot connect fluids because exactly one fluid input and output are required');
  }
  if (solidInputs?.length !== 0 || solidOutputs?.length !== 0) {
    return failed('cannot connect solid resources alongside both fluid trunks');
  }
  if (!specification.size || !specification.fluidBoxes) {
    return failed(
      'cannot connect fluids to',
      specification.name,
      'because its size or fluid-port geometry is missing',
    );
  }

  const direction = fluidRotation(specification, 'input', 'west', 'output', 'east');
  if (!direction) {
    return failed(
      'cannot connect fluids to',
      specification.name,
      'because it has no rotation with input and output ports on opposite sides',
    );
  }

  const size = rotatedSize(specification.size, direction);
  const entities: DesignEntity[] = [
    ...pipeTrunk(0, size.height),
    {
      kind: 'assembler',
      position: { x: 1, y: 0 },
      size,
      recipe: specification.name,
      direction,
    },
    ...pipeTrunk(size.width + 1, size.height),
  ];
  return { columns: [{ entities }] };
}

function generateFluidOutputDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): AssemblerDesignResult {
  const inputRates = positiveRates(problem.inputs.solids);
  const solidOutputRates = optionalPositiveRates(problem.outputs.solids);
  const fluidOutputRates = positiveRates(problem.outputs.fluids);
  if (!inputRates) return invalidRates('input', problem.inputs.solids);
  if (inputRates.length > 4) {
    return failed('cannot feed more than 4 solid inputs alongside a fluid output');
  }
  if (!solidOutputRates || solidOutputRates.length !== 0) {
    return failed('cannot extract a solid output alongside the fluid output');
  }
  if (!fluidOutputRates || fluidOutputRates.length !== 1) {
    return failed('cannot connect anything other than one fluid output');
  }
  if (!problem.assemblers[0].size || !problem.assemblers[0].fluidBoxes) {
    return failed(
      'cannot connect the fluid output to',
      problem.assemblers[0].name,
      'because its size or fluid-port geometry is missing',
    );
  }
  const assemblerDirection = fluidRotation(problem.assemblers[0], 'output', 'west');
  if (!assemblerDirection) {
    return failed(
      'cannot connect the fluid output to',
      problem.assemblers[0].name,
      'because it has no output port facing the pipe trunk',
    );
  }

  const nearInputRate = sum(inputRates.slice(0, 2));
  const farInputRate = sum(inputRates.slice(2, 4));
  if (
    nearInputRate > throughput.beltItemsPerSecond ||
    farInputRate > throughput.beltItemsPerSecond
  ) {
    return failed('cannot feed the solid inputs because their rate exceeds the input belts');
  }

  const nearInserterCount = Math.ceil(nearInputRate / throughput.inserterItemsPerSecond);
  const farInserterCount = Math.ceil(farInputRate / throughput.longInserterItemsPerSecond);
  if (nearInserterCount + farInserterCount > 3) {
    return inserterFailure(
      'insert',
      Object.keys(problem.inputs.solids),
      problem,
      nearInserterCount + farInserterCount,
      3,
    );
  }
  const nearInserterYs = edgeRows.slice(0, nearInserterCount);
  const farInserterYs = outputRows
    .filter((y) => !nearInserterYs.includes(y))
    .slice(0, farInserterCount);
  if (farInserterYs.length !== farInserterCount) {
    return failed('cannot place the required long inserters without overlapping another inserter');
  }

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
    assembler(problem, 1, assemblerDirection),
  ];

  return { columns: [{ entities }] };
}

function generateFluidInputDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): AssemblerDesignResult {
  const fluidInputRates = positiveRates(problem.inputs.fluids);
  const inputRates = optionalPositiveRates(problem.inputs.solids);
  const outputRates = positiveRates(problem.outputs.solids);
  if (!fluidInputRates || fluidInputRates.length !== 1) {
    return failed('cannot connect anything other than one fluid input');
  }
  if (!inputRates) return invalidRates('input', problem.inputs.solids);
  if (inputRates.length > 2) {
    return failed('cannot feed more than 2 solid inputs alongside a fluid input');
  }
  if (!outputRates || outputRates.length !== 1) {
    return failed('cannot extract anything other than one solid output alongside a fluid input');
  }
  if (!problem.assemblers[0].size || !problem.assemblers[0].fluidBoxes) {
    return failed(
      'cannot connect the fluid input to',
      problem.assemblers[0].name,
      'because its size or fluid-port geometry is missing',
    );
  }
  const assemblerDirection = fluidRotation(problem.assemblers[0], 'input', 'west');
  if (!assemblerDirection) {
    return failed(
      'cannot connect the fluid input to',
      problem.assemblers[0].name,
      'because it has no input port facing the pipe trunk',
    );
  }

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  const hasSolidInput = inputRates.length > 0;
  if (inputRate > throughput.beltItemsPerSecond || outputRate > throughput.beltItemsPerSecond) {
    return failed('cannot carry the solid resources because their rate exceeds a belt');
  }

  const inputInserterCount = Math.ceil(inputRate / throughput.inserterItemsPerSecond);
  const outputItemsPerSecond = hasSolidInput
    ? throughput.longInserterItemsPerSecond
    : throughput.inserterItemsPerSecond;
  const outputInserterCount = Math.ceil(outputRate / outputItemsPerSecond);
  if (inputInserterCount + outputInserterCount > 3) {
    return failed(
      'cannot serve',
      problem.assemblers[0].name,
      'because input and output need',
      count(inputInserterCount + outputInserterCount, 'inserter'),
      'but only 3 tiles are available beside the assembler',
    );
  }

  const inputYs = edgeRows.slice(0, inputInserterCount);
  const outputYs = outputRows.filter((y) => !inputYs.includes(y)).slice(0, outputInserterCount);
  if (outputYs.length !== outputInserterCount) {
    return failed(
      'cannot place the required output inserters without overlapping an input inserter',
    );
  }

  const outputBeltX = hasSolidInput ? 6 : 5;
  const entities: DesignEntity[] = [
    ...pipeTrunk(),
    ...(hasSolidInput ? verticalBelt(5, 'north') : []),
    ...inputYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: 4, y },
      direction: 'west',
    })),
    assembler(problem, 1, assemblerDirection),
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

function pipeTrunk(x = 0, height = 3): DesignEntity[] {
  return Array.from({ length: height }, (_, y) => ({ kind: 'pipe', position: { x, y } }));
}

function assembler(problem: KernelProblem, x: number, direction?: DesignDirection): DesignEntity {
  const specification = problem.assemblers[0];
  return {
    kind: 'assembler',
    position: { x, y: 0 },
    size: specification.size ? rotatedSize(specification.size, direction) : { width: 3, height: 3 },
    recipe: specification.name,
    ...(direction ? { direction } : {}),
  };
}

function fluidRotation(
  specification: KernelProblem['assemblers'][number],
  firstFlow: 'input' | 'output',
  firstTarget: DesignDirection,
  secondFlow?: 'input' | 'output',
  secondTarget?: DesignDirection,
): DesignDirection | undefined {
  if (!specification.fluidBoxes) return undefined;
  return (['north', 'east', 'south', 'west'] as const).find(
    (direction) =>
      hasRotatedFluidPort(specification, firstFlow, firstTarget, direction) &&
      (!secondFlow ||
        !secondTarget ||
        hasRotatedFluidPort(specification, secondFlow, secondTarget, direction)),
  );
}

function hasRotatedFluidPort(
  specification: KernelProblem['assemblers'][number],
  flow: 'input' | 'output',
  target: DesignDirection,
  rotation: DesignDirection,
): boolean {
  return Boolean(
    specification.fluidBoxes?.some(
      (box) =>
        (box.productionType === flow || box.productionType === 'input-output') &&
        box.connections.some(
          (connection) =>
            (connection.flowDirection === flow || connection.flowDirection === 'input-output') &&
            rotateDirection(connection.direction, rotation) === target,
        ),
    ),
  );
}

function rotateDirection(direction: DesignDirection, rotation: DesignDirection): DesignDirection {
  const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
  return directions[(directions.indexOf(direction) + directions.indexOf(rotation)) % 4];
}

function rotatedSize(
  size: { width: number; height: number },
  direction: DesignDirection | undefined,
) {
  return direction === 'east' || direction === 'west'
    ? { width: size.height, height: size.width }
    : size;
}

function wideInputSites(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
  outputInserterCount: number,
): InputSite[] | AssemblerDesignFailure {
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
      return failed(
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
    return failed(
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
): InputSite[] | AssemblerDesignFailure {
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

function failed(...failure: string[]): AssemblerDesignFailure {
  return { failure };
}

function invalidRates(side: 'input' | 'output', rates: ResourceRates): AssemblerDesignFailure {
  return failed(
    `cannot use the ${side} rates because`,
    Object.keys(rates).length === 0
      ? `there are no ${side} resources`
      : 'every rate must be a finite positive number',
  );
}

function inserterFailure(
  operation: 'insert' | 'extract',
  resources: string[],
  problem: KernelProblem,
  required: number,
  available: number,
): AssemblerDesignFailure {
  const preposition = operation === 'insert' ? 'into' : 'from';
  return failed(
    `cannot ${operation}`,
    resources.join(' and '),
    preposition,
    problem.assemblers[0].name,
    'because',
    count(required, 'inserter'),
    'are needed but only',
    count(available, 'tile'),
    `${available === 1 ? 'is' : 'are'} available beside the assembler`,
  );
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function rate(value: number): string {
  return rateText(value);
}

function rateText(value: number): string {
  return `${value} items/s`;
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
