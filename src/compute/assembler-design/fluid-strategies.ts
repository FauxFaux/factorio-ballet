import type { DesignDirection, DesignEntity } from '../design.ts';
import type { KernelProblem } from '../kernel-problems.ts';
import { solveWideSolidDesign } from './solid-strategies.ts';
import {
  assembler,
  count,
  inserterFailure,
  notApplicable,
  pipeTrunk,
  reject,
  rejected,
  rotatedSize,
  solved,
  sum,
  verticalBelt,
  type AssemblerDesignStrategyResult,
  type PreparedAssemblerProblem,
} from './strategy.ts';

function sideRows(height: number): number[] {
  return [height - 1, ...Array.from({ length: height - 1 }, (_, y) => y)];
}

function outputSideRows(height: number): number[] {
  const middle = Math.floor(height / 2);
  return [middle, ...Array.from({ length: height }, (_, y) => y).filter((y) => y !== middle)];
}

/**
 * Add the outside fluid plumbing from the documented `3s-1f-in-1s-out` kernel to the wide solid
 * design. The pipe-to-ground takes the middle inserter site and crosses both intervening belts;
 * the outer belt also goes underground where it crosses the pipe endpoint beside the trunk.
 */
export function solveOutsideFluidTrunkDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem } = prepared;
  const hasInputFluid = prepared.inputFluids.length > 0;
  const hasOutputFluid = prepared.outputFluids.length > 0;
  if (!hasInputFluid && !hasOutputFluid) return notApplicable();
  if (prepared.inputSolids.length !== 3 || prepared.outputSolids.length !== 1) {
    return notApplicable();
  }
  if (prepared.inputFluids.length > 1 || prepared.outputFluids.length > 1) {
    return reject(
      'unsupported-flows',
      'cannot connect more than one fluid input or output with outside fluid trunks',
    );
  }

  const specification = problem.assemblers[0];
  if (!specification.size || !specification.fluidBoxes) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because its size or fluid-port geometry is missing',
    );
  }
  if (specification.size.width !== 3 || specification.size.height !== 3) {
    return reject(
      'machine-geometry',
      'cannot use outside fluid trunks with',
      specification.name,
      'because the 3s-1f-in-1s-out layout requires a 3x3 machine',
    );
  }

  const assemblerDirection =
    hasInputFluid && hasOutputFluid
      ? centeredFluidRotation(specification, 'input', 'west', 'output', 'east')
      : centeredFluidRotation(specification, hasInputFluid ? 'input' : 'output', 'east');
  if (!assemblerDirection) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because it has no rotation with the required middle-edge fluid ports',
    );
  }

  const solidResult = solveWideSolidDesign({
    ...prepared,
    inputFluids: [],
    outputFluids: [],
  });
  if (solidResult.kind !== 'candidate') return solidResult;

  const entities = solidResult.design.columns[0].entities.map((entity) =>
    entity.kind === 'assembler' ? { ...entity, direction: assemblerDirection } : { ...entity },
  );
  const rightFailure = addRightFluidTrunk(entities);
  if (rightFailure) return rightFailure;
  if (hasInputFluid && hasOutputFluid) {
    const leftFailure = addLeftFluidTrunk(entities);
    if (leftFailure) return leftFailure;
  }

  return solved({ columns: [{ entities }] });
}

/**
 * Feed up to two solids alongside opposing fluid input/output ports. With two solids, each side
 * gets an underground belt and its fluid connection passes through the belt's middle row.
 */
export function solveDualFluidSolidInputDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput } = prepared;
  if (prepared.inputFluids.length === 0 || prepared.outputFluids.length === 0) {
    return notApplicable();
  }
  if (
    prepared.inputSolids.length < 1 ||
    prepared.inputSolids.length > 2 ||
    prepared.outputSolids.length !== 0
  ) {
    return notApplicable();
  }
  if (prepared.inputFluids.length !== 1 || prepared.outputFluids.length !== 1) {
    return reject(
      'unsupported-flows',
      'cannot connect fluids because exactly one fluid input and output are required',
    );
  }

  const specification = problem.assemblers[0];
  if (!specification.size || !specification.fluidBoxes) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because its size or fluid-port geometry is missing',
    );
  }
  const assemblerDirection = centeredFluidRotation(
    specification,
    'input',
    'west',
    'output',
    'east',
  );
  if (!assemblerDirection) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because it has no rotation with opposing middle-edge input and output ports',
    );
  }
  const size = rotatedSize(specification.size, assemblerDirection);
  const middle = Math.floor(size.height / 2);
  const inserterYs = sideRows(size.height).filter((y) => y !== middle);
  if (inserterYs.length < 2) {
    return reject('machine-geometry', 'cannot fit solid inserters beside both fluid ports');
  }

  const singleRate = prepared.inputSolids[0];
  const sideCapacity = Math.min(
    throughput.beltItemsPerSecond,
    inserterYs.length * throughput.inserterItemsPerSecond,
  );
  const useBothSides = prepared.inputSolids.length === 2 || singleRate > sideCapacity;
  if (
    prepared.inputSolids.length === 2
      ? prepared.inputSolids.some((rate) => rate > throughput.beltItemsPerSecond)
      : singleRate > 2 * throughput.beltItemsPerSecond
  ) {
    return reject(
      'transport-capacity',
      'cannot feed a solid input because its rate exceeds the available input belts',
    );
  }
  const sideRates =
    prepared.inputSolids.length === 2
      ? prepared.inputSolids
      : useBothSides
        ? [Math.min(singleRate, sideCapacity), singleRate - Math.min(singleRate, sideCapacity)]
        : [singleRate];
  for (const [index, rate] of sideRates.entries()) {
    const inserterCount = Math.ceil(rate / throughput.inserterItemsPerSecond);
    if (inserterCount > inserterYs.length) {
      return rejected(
        inserterFailure(
          'insert',
          [Object.keys(problem.inputs.solids)[Math.min(index, prepared.inputSolids.length - 1)]],
          problem,
          inserterCount,
          inserterYs.length,
        ),
      );
    }
  }

  if (useBothSides) {
    const rightInserterX = 3 + size.width;
    const entities: DesignEntity[] = [
      ...pipeTrunk(0, size.height),
      ...undergroundNorthBelt(1, size.height),
      ...inserterYs
        .slice(0, Math.ceil(sideRates[0] / throughput.inserterItemsPerSecond))
        .map((y): DesignEntity => ({
          kind: 'inserter',
          position: { x: 2, y },
          direction: 'east',
        })),
      assembler(problem, 3, assemblerDirection),
      ...inserterYs
        .slice(0, Math.ceil(sideRates[1] / throughput.inserterItemsPerSecond))
        .map((y): DesignEntity => ({
          kind: 'inserter',
          position: { x: rightInserterX, y },
          direction: 'west',
        })),
      ...undergroundNorthBelt(rightInserterX + 1, size.height),
      { kind: 'underground-pipe', position: { x: 1, y: middle }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 2, y: middle }, direction: 'east' },
      { kind: 'underground-pipe', position: { x: rightInserterX, y: middle }, direction: 'west' },
      {
        kind: 'underground-pipe',
        position: { x: rightInserterX + 1, y: middle },
        direction: 'east',
      },
      ...pipeTrunk(rightInserterX + 2, size.height),
    ];
    return solved({ columns: [{ entities }] });
  }

  const entities: DesignEntity[] = [
    ...pipeTrunk(0, size.height),
    assembler(problem, 1, assemblerDirection),
    ...inserterYs
      .slice(0, Math.ceil(prepared.inputSolids[0] / throughput.inserterItemsPerSecond))
      .map((y): DesignEntity => ({
        kind: 'inserter',
        position: { x: 1 + size.width, y },
        direction: 'west',
      })),
    ...undergroundNorthBelt(2 + size.width, size.height),
    { kind: 'underground-pipe', position: { x: 1 + size.width, y: middle }, direction: 'west' },
    { kind: 'underground-pipe', position: { x: 2 + size.width, y: middle }, direction: 'east' },
    ...pipeTrunk(3 + size.width, size.height),
  ];
  return solved({ columns: [{ entities }] });
}

function undergroundNorthBelt(x: number, height = 3): DesignEntity[] {
  const middle = Math.floor(height / 2);
  return [
    ...Array.from({ length: middle - 1 }, (_, y): DesignEntity => ({
      kind: 'belt',
      position: { x, y },
      direction: 'north',
    })),
    { kind: 'underground-belt', position: { x, y: middle + 1 }, direction: 'north', end: 'input' },
    { kind: 'underground-belt', position: { x, y: middle - 1 }, direction: 'north', end: 'output' },
    ...Array.from({ length: height - middle - 2 }, (_, index): DesignEntity => ({
      kind: 'belt',
      position: { x, y: middle + 2 + index },
      direction: 'north',
    })),
  ];
}

/** Two solid inputs and one solid output around opposing middle-edge fluid ports. */
export function solveDualFluidSolidOutputDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput, inputSolids, outputSolids } = prepared;
  if (
    inputSolids.length !== 2 ||
    outputSolids.length !== 1 ||
    prepared.inputFluids.length !== 1 ||
    prepared.outputFluids.length !== 1
  ) {
    return notApplicable();
  }

  const specification = problem.assemblers[0];
  if (!specification.size || !specification.fluidBoxes) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because its size or fluid-port geometry is missing',
    );
  }
  if (specification.size.width !== 3 || specification.size.height !== 3) {
    return reject('machine-geometry', 'this solid and fluid layout requires a 3x3 machine');
  }
  const direction = centeredFluidRotation(specification, 'input', 'west', 'output', 'east');
  if (!direction) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because it has no rotation with opposing middle-edge input and output ports',
    );
  }

  if (inputSolids.some((rate) => rate > throughput.beltItemsPerSecond)) {
    return reject(
      'transport-capacity',
      'cannot carry a solid input because its rate exceeds one belt',
    );
  }
  const outputRate = outputSolids[0];
  if (outputRate > throughput.beltItemsPerSecond) {
    return reject(
      'transport-capacity',
      'cannot carry the solid output because its rate exceeds one belt',
    );
  }
  const outputInserterCount = Math.ceil(outputRate / throughput.inserterItemsPerSecond);
  if (outputInserterCount > 2) {
    return rejected(
      inserterFailure(
        'extract',
        Object.keys(problem.outputs.solids),
        problem,
        outputInserterCount,
        2,
      ),
    );
  }

  // Assign the slower input to the far belt. When a long inserter cannot carry either input,
  // both resources may share the near belt if its two lanes and inserters can carry their sum.
  const farRate = Math.min(...inputSolids);
  const nearRate = Math.max(...inputSolids);
  const useFarBelt =
    farRate <= throughput.longInserterItemsPerSecond &&
    nearRate <= throughput.inserterItemsPerSecond;
  const sharedRate = sum(inputSolids);
  if (
    !useFarBelt &&
    (sharedRate > throughput.beltItemsPerSecond ||
      inputSolids.some((rate) => rate > throughput.beltItemsPerSecond / 2) ||
      sharedRate > 2 * throughput.inserterItemsPerSecond)
  ) {
    return reject(
      'transport-capacity',
      'cannot feed both solid inputs through the available belts and inserter sites',
    );
  }

  const inputInserters: DesignEntity[] = useFarBelt
    ? [
        { kind: 'inserter', position: { x: 3, y: 0 }, direction: 'east', reach: 2 },
        { kind: 'inserter', position: { x: 3, y: 2 }, direction: 'east' },
      ]
    : [0, 2]
        .slice(0, Math.ceil(sharedRate / throughput.inserterItemsPerSecond))
        .map((y) => ({ kind: 'inserter', position: { x: 3, y }, direction: 'east' }));
  const entities: DesignEntity[] = [
    ...pipeTrunk(),
    ...(useFarBelt ? undergroundNorthBelt(1) : []),
    ...verticalBelt(2, 'north'),
    ...inputInserters,
    assembler(problem, 4, direction),
    ...[0, 2].slice(0, outputInserterCount).map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: 7, y },
      direction: 'east',
    })),
    { kind: 'underground-belt', position: { x: 8, y: 0 }, direction: 'south', end: 'input' },
    { kind: 'underground-belt', position: { x: 8, y: 2 }, direction: 'south', end: 'output' },
    { kind: 'underground-pipe', position: { x: 1, y: 1 }, direction: 'west' },
    { kind: 'underground-pipe', position: { x: 3, y: 1 }, direction: 'east' },
    { kind: 'underground-pipe', position: { x: 7, y: 1 }, direction: 'west' },
    { kind: 'underground-pipe', position: { x: 8, y: 1 }, direction: 'east' },
    ...pipeTrunk(9),
  ];
  return solved({ columns: [{ entities }] });
}

export function solveDualFluidDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem } = prepared;
  if (prepared.inputFluids.length === 0 || prepared.outputFluids.length === 0) {
    return notApplicable();
  }
  const specification = problem.assemblers[0];
  if (prepared.inputFluids.length !== 1 || prepared.outputFluids.length !== 1) {
    return reject(
      'unsupported-flows',
      'cannot connect fluids because exactly one fluid input and output are required',
    );
  }
  if (prepared.inputSolids.length !== 0 || prepared.outputSolids.length !== 0) {
    return reject(
      'unsupported-flows',
      'cannot connect solid resources alongside both fluid trunks',
    );
  }
  if (!specification.size || !specification.fluidBoxes) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because its size or fluid-port geometry is missing',
    );
  }

  const direction = fluidRotation(specification, 'input', 'west', 'output', 'east');
  if (!direction) {
    return reject(
      'machine-geometry',
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
  return solved({ columns: [{ entities }] });
}

/** A no-solid three-trunk variant of the documented rectangular chemical-plant pattern. */
export function solveOneFluidTwoOutputsDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem } = prepared;
  if (
    prepared.inputFluids.length !== 1 ||
    prepared.outputFluids.length !== 2 ||
    prepared.inputSolids.length !== 0 ||
    prepared.outputSolids.length !== 0
  ) {
    return notApplicable();
  }

  const specification = problem.assemblers[0];
  if (!specification.size || !specification.fluidBoxes) {
    return reject(
      'machine-geometry',
      'cannot connect fluids to',
      specification.name,
      'because its size or fluid-port geometry is missing',
    );
  }
  if (specification.size.width !== 3 || specification.size.height !== 3) {
    return reject('machine-geometry', 'the three-fluid-trunk layout requires a 3x3 machine');
  }

  const direction = (['north', 'east', 'south', 'west'] as const).find((rotation) => {
    const input = rotatedPortBoxIndex(specification, 'input', 'east', { x: 1, y: -1 }, rotation);
    const upperOutput = rotatedPortBoxIndex(
      specification,
      'output',
      'west',
      { x: -1, y: -1 },
      rotation,
    );
    const lowerOutput = rotatedPortBoxIndex(
      specification,
      'output',
      'west',
      { x: -1, y: 1 },
      rotation,
    );
    return (
      input !== undefined &&
      upperOutput !== undefined &&
      lowerOutput !== undefined &&
      new Set([input, upperOutput, lowerOutput]).size === 3 &&
      trunkFacesOnlyFluidInputs(specification, 'east', rotation)
    );
  });
  if (!direction) {
    return reject(
      'machine-geometry',
      'cannot connect one fluid input and two fluid outputs to',
      specification.name,
      'because the required corner ports are unavailable',
    );
  }

  const entities: DesignEntity[] = [
    ...pipeTrunk(0),
    ...pipeTrunk(2),
    ...pipeTrunk(7),
    { kind: 'underground-pipe', position: { x: 1, y: 2 }, direction: 'west' },
    { kind: 'pipe', position: { x: 3, y: 0 } },
    { kind: 'underground-pipe', position: { x: 3, y: 2 }, direction: 'east' },
    assembler(problem, 4, direction),
  ];
  return solved({ columns: [{ entities }] });
}

export function solveFluidOutputDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput, inputSolids: inputRates } = prepared;
  if (prepared.inputFluids.length > 0 || prepared.outputFluids.length === 0) {
    return notApplicable();
  }
  if (inputRates.length > 4) {
    return reject(
      'unsupported-flows',
      'cannot feed more than 4 solid inputs alongside a fluid output',
    );
  }
  if (prepared.outputSolids.length !== 0) {
    return reject('unsupported-flows', 'cannot extract a solid output alongside the fluid output');
  }
  if (prepared.outputFluids.length !== 1) {
    return reject('unsupported-flows', 'cannot connect anything other than one fluid output');
  }
  if (!problem.assemblers[0].size || !problem.assemblers[0].fluidBoxes) {
    return reject(
      'machine-geometry',
      'cannot connect the fluid output to',
      problem.assemblers[0].name,
      'because its size or fluid-port geometry is missing',
    );
  }
  const assemblerDirection = fluidRotation(problem.assemblers[0], 'output', 'west');
  if (!assemblerDirection) {
    return reject(
      'machine-geometry',
      'cannot connect the fluid output to',
      problem.assemblers[0].name,
      'because it has no output port facing the pipe trunk',
    );
  }
  const size = rotatedSize(problem.assemblers[0].size, assemblerDirection);
  const rightX = size.width + 1;

  if (inputRates.length === 0) {
    const size = rotatedSize(problem.assemblers[0].size, assemblerDirection);
    return solved({
      columns: [
        { entities: [...pipeTrunk(0, size.height), assembler(problem, 1, assemblerDirection)] },
      ],
    });
  }

  const nearInputRate = sum(inputRates.slice(0, 2));
  const farInputRate = sum(inputRates.slice(2, 4));
  if (
    nearInputRate > throughput.beltItemsPerSecond ||
    farInputRate > throughput.beltItemsPerSecond
  ) {
    return reject(
      'transport-capacity',
      'cannot feed the solid inputs because their rate exceeds the input belts',
    );
  }

  const nearInserterCount = Math.ceil(nearInputRate / throughput.inserterItemsPerSecond);
  const farInserterCount = Math.ceil(farInputRate / throughput.longInserterItemsPerSecond);
  if (nearInserterCount + farInserterCount > size.height) {
    return rejected(
      inserterFailure(
        'insert',
        Object.keys(problem.inputs.solids),
        problem,
        nearInserterCount + farInserterCount,
        size.height,
      ),
    );
  }
  const nearInserterYs = sideRows(size.height).slice(0, nearInserterCount);
  const farInserterYs = outputSideRows(size.height)
    .filter((y) => !nearInserterYs.includes(y))
    .slice(0, farInserterCount);
  if (farInserterYs.length !== farInserterCount) {
    return reject(
      'entity-placement',
      'cannot place the required long inserters without overlapping another inserter',
    );
  }

  const entities: DesignEntity[] = [
    ...pipeTrunk(0, size.height),
    ...verticalBelt(rightX + 1, 'north', size.height),
    ...(farInputRate > 0 ? verticalBelt(rightX + 2, 'north', size.height) : []),
    ...nearInserterYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: rightX, y },
      direction: 'west',
    })),
    ...farInserterYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: rightX, y },
      direction: 'west',
      reach: 2,
    })),
    assembler(problem, 1, assemblerDirection),
  ];

  return solved({ columns: [{ entities }] });
}

export function solveFluidInputDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput, inputSolids: inputRates, outputSolids: outputRates } = prepared;
  if (prepared.inputFluids.length === 0 || prepared.outputFluids.length > 0) {
    return notApplicable();
  }
  if (prepared.inputFluids.length !== 1) {
    return reject('unsupported-flows', 'cannot connect anything other than one fluid input');
  }
  if (inputRates.length > 2) {
    return reject(
      'unsupported-flows',
      'cannot feed more than 2 solid inputs alongside a fluid input',
    );
  }
  if (outputRates.length > 1) {
    return reject(
      'unsupported-flows',
      'cannot extract more than one solid output alongside a fluid input',
    );
  }
  if (!problem.assemblers[0].size || !problem.assemblers[0].fluidBoxes) {
    return reject(
      'machine-geometry',
      'cannot connect the fluid input to',
      problem.assemblers[0].name,
      'because its size or fluid-port geometry is missing',
    );
  }
  const assemblerDirection = fluidRotation(problem.assemblers[0], 'input', 'west');
  if (!assemblerDirection) {
    return reject(
      'machine-geometry',
      'cannot connect the fluid input to',
      problem.assemblers[0].name,
      'because it has no input port facing the pipe trunk',
    );
  }
  const size = rotatedSize(problem.assemblers[0].size, assemblerDirection);
  const rightX = size.width + 1;

  const inputRate = sum(inputRates);
  const outputRate = sum(outputRates);
  const hasSolidInput = inputRates.length > 0;
  if (inputRate > throughput.beltItemsPerSecond || outputRate > throughput.beltItemsPerSecond) {
    return reject(
      'transport-capacity',
      'cannot carry the solid resources because their rate exceeds a belt',
    );
  }

  const inputInserterCount = Math.ceil(inputRate / throughput.inserterItemsPerSecond);
  const outputItemsPerSecond = hasSolidInput
    ? throughput.longInserterItemsPerSecond
    : throughput.inserterItemsPerSecond;
  const outputInserterCount = Math.ceil(outputRate / outputItemsPerSecond);
  if (inputInserterCount + outputInserterCount > size.height) {
    return reject(
      'entity-placement',
      'cannot serve',
      problem.assemblers[0].name,
      'because input and output need',
      count(inputInserterCount + outputInserterCount, 'inserter'),
      `but only ${size.height} tiles are available beside the assembler`,
    );
  }

  const inputYs = sideRows(size.height).slice(0, inputInserterCount);
  const outputYs = outputSideRows(size.height)
    .filter((y) => !inputYs.includes(y))
    .slice(0, outputInserterCount);
  if (outputYs.length !== outputInserterCount) {
    return reject(
      'entity-placement',
      'cannot place the required output inserters without overlapping an input inserter',
    );
  }

  const outputBeltX = rightX + (hasSolidInput ? 2 : 1);
  const entities: DesignEntity[] = [
    ...pipeTrunk(0, size.height),
    ...(hasSolidInput ? verticalBelt(rightX + 1, 'north', size.height) : []),
    ...inputYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: rightX, y },
      direction: 'west',
    })),
    assembler(problem, 1, assemblerDirection),
    ...outputYs.map((y): DesignEntity => ({
      kind: 'inserter',
      position: { x: rightX, y },
      direction: 'east',
      ...(hasSolidInput ? { reach: 2 } : {}),
    })),
    ...(outputInserterCount > 0 ? verticalBelt(outputBeltX, 'south', size.height) : []),
  ];

  return solved({ columns: [{ entities }] });
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

function centeredFluidRotation(
  specification: KernelProblem['assemblers'][number],
  firstFlow: 'input' | 'output',
  firstTarget: 'east' | 'west',
  secondFlow?: 'input' | 'output',
  secondTarget?: 'east' | 'west',
): DesignDirection | undefined {
  return (['north', 'east', 'south', 'west'] as const).find(
    (direction) =>
      hasRotatedCenteredFluidPort(specification, firstFlow, firstTarget, direction) &&
      (!secondFlow ||
        !secondTarget ||
        hasRotatedCenteredFluidPort(specification, secondFlow, secondTarget, direction)),
  );
}

function hasRotatedCenteredFluidPort(
  specification: KernelProblem['assemblers'][number],
  flow: 'input' | 'output',
  target: 'east' | 'west',
  rotation: DesignDirection,
): boolean {
  if (!specification.size) return false;
  const halfWidth = Math.floor(rotatedSize(specification.size, rotation).width / 2);
  const targetPosition = { x: target === 'east' ? halfWidth : -halfWidth, y: 0 };
  return Boolean(
    specification.fluidBoxes?.some(
      (box) =>
        (box.productionType === flow || box.productionType === 'input-output') &&
        box.connections.some((connection) => {
          const position = rotatePosition(connection.position, rotation);
          return (
            (connection.flowDirection === flow || connection.flowDirection === 'input-output') &&
            rotateDirection(connection.direction, rotation) === target &&
            position.x === targetPosition.x &&
            position.y === targetPosition.y
          );
        }),
    ),
  );
}

function addRightFluidTrunk(entities: DesignEntity[]): AssemblerDesignStrategyResult | undefined {
  const outputInserters = entities.filter(
    (entity) =>
      entity.kind === 'inserter' &&
      entity.position.x === 6 &&
      entity.direction === 'east' &&
      entity.reach === 2,
  );
  if (outputInserters.length !== 1 || positionOccupied(entities, 6, 0, outputInserters[0])) {
    return reject(
      'entity-placement',
      'cannot reserve the middle east inserter slot for the fluid connection',
    );
  }
  outputInserters[0].position = { x: 6, y: 0 };
  if (!replaceBeltWithUnderground(entities, 8, 'south')) {
    return reject('entity-placement', 'cannot route the output belt beneath the fluid connection');
  }
  entities.push(
    { kind: 'underground-pipe', position: { x: 6, y: 1 }, direction: 'west' },
    { kind: 'underground-pipe', position: { x: 8, y: 1 }, direction: 'east' },
    ...pipeTrunk(9),
  );
  return undefined;
}

function addLeftFluidTrunk(entities: DesignEntity[]): AssemblerDesignStrategyResult | undefined {
  const displacedInserter = entities.find(
    (entity) => entity.kind === 'inserter' && entity.position.x === 2 && entity.position.y === 1,
  );
  if (displacedInserter) {
    if (positionOccupied(entities, 2, 0, displacedInserter)) {
      return reject(
        'entity-placement',
        'cannot reserve the middle west inserter slot for the fluid connection',
      );
    }
    displacedInserter.position = { x: 2, y: 0 };
  }

  const farWestBelts = entities.filter(
    (entity) => entity.kind === 'belt' && entity.position.x === 0,
  );
  if (farWestBelts.length > 0 && !replaceBeltWithUnderground(entities, 0, 'north')) {
    return reject(
      'entity-placement',
      'cannot route the far input belt beneath the fluid connection',
    );
  }
  entities.push(
    { kind: 'underground-pipe', position: { x: 2, y: 1 }, direction: 'east' },
    { kind: 'underground-pipe', position: { x: 0, y: 1 }, direction: 'west' },
    ...pipeTrunk(-1),
  );
  return undefined;
}

function replaceBeltWithUnderground(
  entities: DesignEntity[],
  x: number,
  direction: 'north' | 'south',
): boolean {
  const belts = entities.filter(
    (entity) => entity.kind === 'belt' && entity.position.x === x && entity.direction === direction,
  );
  if (belts.length !== 3 || belts.some((belt) => belt.position.y < 0 || belt.position.y > 2)) {
    return false;
  }
  for (const belt of belts) entities.splice(entities.indexOf(belt), 1);
  entities.push(
    {
      kind: 'underground-belt',
      position: { x, y: direction === 'south' ? 0 : 2 },
      direction,
      end: 'input',
    },
    {
      kind: 'underground-belt',
      position: { x, y: direction === 'south' ? 2 : 0 },
      direction,
      end: 'output',
    },
  );
  return true;
}

function positionOccupied(
  entities: DesignEntity[],
  x: number,
  y: number,
  ignored: DesignEntity,
): boolean {
  return entities.some(
    (entity) =>
      entity !== ignored &&
      entity.kind !== 'assembler' &&
      entity.position.x === x &&
      entity.position.y === y,
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

function rotatedPortBoxIndex(
  specification: KernelProblem['assemblers'][number],
  flow: 'input' | 'output',
  target: DesignDirection,
  position: { x: number; y: number },
  rotation: DesignDirection,
): number | undefined {
  const index = specification.fluidBoxes?.findIndex(
    (box) =>
      (box.productionType === flow || box.productionType === 'input-output') &&
      box.connections.some((connection) => {
        const rotated = rotatePosition(connection.position, rotation);
        return (
          (connection.flowDirection === flow || connection.flowDirection === 'input-output') &&
          rotateDirection(connection.direction, rotation) === target &&
          rotated.x === position.x &&
          rotated.y === position.y
        );
      }),
  );
  return index === -1 ? undefined : index;
}

function trunkFacesOnlyFluidInputs(
  specification: KernelProblem['assemblers'][number],
  side: 'east' | 'west',
  rotation: DesignDirection,
): boolean {
  const edgeX = side === 'east' ? 1 : -1;
  const ports = specification.fluidBoxes!.flatMap((box) =>
    box.connections.flatMap((connection) => {
      const position = rotatePosition(connection.position, rotation);
      return rotateDirection(connection.direction, rotation) === side && position.x === edgeX
        ? [{ box, connection }]
        : [];
    }),
  );
  return (
    ports.length > 0 &&
    ports.every(
      ({ box, connection }) =>
        (box.productionType === 'input' || box.productionType === 'input-output') &&
        (connection.flowDirection === 'input' || connection.flowDirection === 'input-output'),
    )
  );
}

function rotateDirection(direction: DesignDirection, rotation: DesignDirection): DesignDirection {
  const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
  return directions[(directions.indexOf(direction) + directions.indexOf(rotation)) % 4];
}

function rotatePosition(
  position: { x: number; y: number },
  rotation: DesignDirection,
): { x: number; y: number } {
  let rotated = position;
  const turns = ['north', 'east', 'south', 'west'].indexOf(rotation);
  for (let turn = 0; turn < turns; turn += 1) {
    rotated = { x: -rotated.y, y: rotated.x };
  }
  return rotated;
}
