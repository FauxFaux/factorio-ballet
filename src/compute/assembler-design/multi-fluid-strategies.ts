import type { DesignEntity } from '../design.ts';
import { fluidRotation, rotatedPortBoxIndex, trunkFacesOnlyFluidInputs } from './fluid-ports.ts';
import {
  assembler,
  notApplicable,
  pipeTrunk,
  reject,
  rotatedSize,
  solved,
  type AssemblerDesignStrategyResult,
  type PreparedAssemblerProblem,
} from './strategy.ts';

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
