import type { DesignEntity } from '../design.ts';
import { fluidRotation } from './fluid-ports.ts';
import {
  assembler,
  count,
  inserterFailure,
  notApplicable,
  pipeTrunk,
  rateText,
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

function outputSideRows(height: number): number[] {
  const middle = Math.floor(height / 2);
  return [middle, ...Array.from({ length: height }, (_, y) => y).filter((y) => y !== middle)];
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

  let nearInputRate = sum(inputRates.slice(0, 2));
  let farInputRate = sum(inputRates.slice(2, 4));
  if (inputRates.length === 1 && nearInputRate > throughput.beltItemsPerSecond) {
    const rate = nearInputRate;
    const beltCapacity = throughput.beltItemsPerSecond;
    const allocations = Array.from({ length: size.height - 1 }, (_, index) => {
      const nearSites = index + 1;
      const nearCapacity = Math.min(beltCapacity, nearSites * throughput.inserterItemsPerSecond);
      const farCapacity = Math.min(
        beltCapacity,
        (size.height - nearSites) * throughput.longInserterItemsPerSecond,
      );
      return { nearCapacity, farCapacity };
    });
    const allocation = allocations.find(
      ({ nearCapacity, farCapacity }) => rate <= nearCapacity + farCapacity + Number.EPSILON,
    );
    if (!allocation) {
      const maximum = Math.max(
        0,
        ...allocations.map(({ nearCapacity, farCapacity }) => nearCapacity + farCapacity),
      );
      return reject(
        'transport-capacity',
        'cannot feed',
        Object.keys(problem.inputs.solids)[0],
        'at',
        rateText(rate),
        'because two',
        rateText(beltCapacity),
        'input belts and their available inserters can transfer at most',
        rateText(maximum),
      );
    }
    nearInputRate = Math.min(rate, allocation.nearCapacity);
    farInputRate = rate - nearInputRate;
  }
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
