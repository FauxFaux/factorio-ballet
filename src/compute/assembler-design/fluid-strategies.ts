import type { DesignDirection, DesignEntity } from '../design.ts';
import type { KernelProblem } from '../kernel-problems.ts';
import {
  assembler,
  count,
  inserterFailure,
  invalidRatesRejection,
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

const edgeRows = [2, 0, 1];
const outputRows = [1, 0, 2];

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

export function solveFluidOutputDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput, inputSolids: inputRates } = prepared;
  if (prepared.inputFluids.length > 0 || prepared.outputFluids.length === 0) {
    return notApplicable();
  }
  if (inputRates.length === 0)
    return rejected(invalidRatesRejection('input', problem.inputs.solids));
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
  if (nearInserterCount + farInserterCount > 3) {
    return rejected(
      inserterFailure(
        'insert',
        Object.keys(problem.inputs.solids),
        problem,
        nearInserterCount + farInserterCount,
        3,
      ),
    );
  }
  const nearInserterYs = edgeRows.slice(0, nearInserterCount);
  const farInserterYs = outputRows
    .filter((y) => !nearInserterYs.includes(y))
    .slice(0, farInserterCount);
  if (farInserterYs.length !== farInserterCount) {
    return reject(
      'entity-placement',
      'cannot place the required long inserters without overlapping another inserter',
    );
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
  if (outputRates.length !== 1) {
    return reject(
      'unsupported-flows',
      'cannot extract anything other than one solid output alongside a fluid input',
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
  if (inputInserterCount + outputInserterCount > 3) {
    return reject(
      'entity-placement',
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
    return reject(
      'entity-placement',
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
