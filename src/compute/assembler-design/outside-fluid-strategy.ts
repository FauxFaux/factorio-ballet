import type { DesignEntity } from '../design.ts';
import { centeredFluidRotation } from './fluid-ports.ts';
import { solveWideSolidDesign } from './solid-strategies.ts';
import {
  notApplicable,
  pipeTrunk,
  reject,
  solved,
  type AssemblerDesignStrategyResult,
  type PreparedAssemblerProblem,
} from './strategy.ts';

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
