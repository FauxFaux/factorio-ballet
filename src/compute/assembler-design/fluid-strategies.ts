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

const edgeRows = [2, 0, 1];
const outputRows = [1, 0, 2];

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
  if (specification.size.width !== 3 || specification.size.height !== 3) {
    return reject(
      'machine-geometry',
      'cannot feed a solid alongside both fluid trunks of',
      specification.name,
      'because this layout requires a 3x3 machine',
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

  if (prepared.inputSolids.some((rate) => rate > throughput.beltItemsPerSecond)) {
    return reject(
      'transport-capacity',
      'cannot feed a solid input because its rate exceeds the input belt',
    );
  }
  const inserterYs = [2, 0];
  for (const [index, rate] of prepared.inputSolids.entries()) {
    const inserterCount = Math.ceil(rate / throughput.inserterItemsPerSecond);
    if (inserterCount > inserterYs.length) {
      return rejected(
        inserterFailure(
          'insert',
          [Object.keys(problem.inputs.solids)[index]],
          problem,
          inserterCount,
          inserterYs.length,
        ),
      );
    }
  }

  if (prepared.inputSolids.length === 2) {
    const entities: DesignEntity[] = [
      ...pipeTrunk(),
      ...undergroundNorthBelt(1),
      ...inserterYs
        .slice(0, Math.ceil(prepared.inputSolids[0] / throughput.inserterItemsPerSecond))
        .map((y): DesignEntity => ({
          kind: 'inserter',
          position: { x: 2, y },
          direction: 'east',
        })),
      assembler(problem, 3, assemblerDirection),
      ...inserterYs
        .slice(0, Math.ceil(prepared.inputSolids[1] / throughput.inserterItemsPerSecond))
        .map((y): DesignEntity => ({
          kind: 'inserter',
          position: { x: 6, y },
          direction: 'west',
        })),
      ...undergroundNorthBelt(7),
      { kind: 'underground-pipe', position: { x: 1, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 2, y: 1 }, direction: 'east' },
      { kind: 'underground-pipe', position: { x: 6, y: 1 }, direction: 'west' },
      { kind: 'underground-pipe', position: { x: 7, y: 1 }, direction: 'east' },
      ...pipeTrunk(8),
    ];
    return solved({ columns: [{ entities }] });
  }

  const entities: DesignEntity[] = [
    ...pipeTrunk(),
    assembler(problem, 1, assemblerDirection),
    ...inserterYs
      .slice(0, Math.ceil(prepared.inputSolids[0] / throughput.inserterItemsPerSecond))
      .map((y): DesignEntity => ({
        kind: 'inserter',
        position: { x: 4, y },
        direction: 'west',
      })),
    ...undergroundNorthBelt(5),
    { kind: 'underground-pipe', position: { x: 4, y: 1 }, direction: 'west' },
    { kind: 'underground-pipe', position: { x: 5, y: 1 }, direction: 'east' },
    ...pipeTrunk(6),
  ];
  return solved({ columns: [{ entities }] });
}

function undergroundNorthBelt(x: number): DesignEntity[] {
  return [
    { kind: 'underground-belt', position: { x, y: 2 }, direction: 'north', end: 'input' },
    { kind: 'underground-belt', position: { x, y: 0 }, direction: 'north', end: 'output' },
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
  const targetPosition = { x: target === 'east' ? 1 : -1, y: 0 };
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
