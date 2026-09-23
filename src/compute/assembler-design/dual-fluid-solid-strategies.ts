import type { DesignEntity } from '../design.ts';
import { centeredFluidRotation } from './fluid-ports.ts';
import {
  assembler,
  inserterFailure,
  notApplicable,
  pipeTrunk,
  reject,
  rejected,
  rotatedSize,
  sideRows,
  solved,
  sum,
  verticalBelt,
  type AssemblerDesignStrategyResult,
  type PreparedAssemblerProblem,
} from './strategy.ts';

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
