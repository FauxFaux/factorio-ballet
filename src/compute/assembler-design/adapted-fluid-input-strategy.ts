import type { DesignEntity } from '../design.ts';
import { fluidBoxResources } from '../fluid-box-resources.ts';
import { rotatedPortBoxIndex } from './fluid-ports.ts';
import {
  assembler,
  notApplicable,
  reject,
  solved,
  sum,
  verticalBelt,
  type AssemblerDesignStrategyResult,
  type PreparedAssemblerProblem,
} from './strategy.ts';

/** The mono-silicon adaptor, reflected to use an unmirrored casting machine. */
export function solveAdaptedFluidInputDesign(
  prepared: PreparedAssemblerProblem,
): AssemblerDesignStrategyResult {
  const { problem, throughput } = prepared;
  if (
    prepared.inputFluids.length !== 2 ||
    prepared.outputFluids.length !== 0 ||
    prepared.inputSolids.length > 4 ||
    prepared.outputSolids.length > 1
  ) {
    return notApplicable();
  }
  const specification = problem.assemblers[0];
  if (
    specification.size?.width !== 3 ||
    specification.size.height !== 3 ||
    !specification.fluidBoxes
  ) {
    return reject(
      'machine-geometry',
      'the two-fluid adaptor requires a 3x3 machine with fluid ports',
    );
  }

  const ingredients = specification.fluidIngredients ?? [
    { resource: 'fluid:input-1' as const },
    { resource: 'fluid:input-2' as const },
  ];
  if (ingredients.length !== 2) {
    return reject('invalid-problem', 'the two-fluid adaptor requires two recipe fluid ingredients');
  }
  const resources = fluidBoxResources(specification, { ingredients, products: [] });
  const direction = (['north', 'east', 'south', 'west'] as const).find((rotation) => {
    const side = rotatedPortBoxIndex(specification, 'input', 'west', { x: -1, y: 1 }, rotation);
    const lower = rotatedPortBoxIndex(specification, 'input', 'south', { x: 1, y: 1 }, rotation);
    // Different prototype boxes can still belong to the same recipe fluid storage.
    return (
      side !== undefined &&
      lower !== undefined &&
      resources.has(side) &&
      resources.has(lower) &&
      resources.get(side) !== resources.get(lower)
    );
  });
  if (!direction) {
    return reject(
      'machine-geometry',
      'cannot adapt two fluid inputs because separate recipe fluids need a lower west port and a rightmost south port',
    );
  }
  const outputRate = prepared.outputSolids[0] ?? 0;
  const inputGroups = groupInputRates(
    prepared.inputSolids,
    outputRate > 0 ? 1 : 2,
    throughput.beltItemsPerSecond,
    throughput.inserterItemsPerSecond,
  );
  if (!inputGroups) {
    return reject(
      'transport-capacity',
      'the adapted fluid layout cannot feed its solid inputs through the available belts and inserters',
    );
  }
  if (outputRate > throughput.beltItemsPerSecond / 2) {
    return reject('transport-capacity', 'the adapted fluid layout output exceeds one belt lane');
  }
  if (outputRate > throughput.inserterItemsPerSecond) {
    return reject(
      'transport-capacity',
      'the adapted fluid layout output exceeds its single free inserter site',
    );
  }

  // Each tile owns rows 0..3, including the previous adaptor's lower seam endpoint.
  // The two underground trunks pair across copies at distance two, below the reach of 10.
  const entities: DesignEntity[] = [
    assembler(problem, 1, direction),
    { kind: 'underground-pipe', position: { x: 0, y: 1 }, direction: 'south' },
    { kind: 'pipe', position: { x: 0, y: 2 } },
    { kind: 'underground-pipe', position: { x: 0, y: 3 }, direction: 'north' },
    { kind: 'underground-pipe', position: { x: 4, y: 0 }, direction: 'north' },
    { kind: 'underground-pipe', position: { x: 4, y: 2 }, direction: 'south' },
    { kind: 'pipe', position: { x: 4, y: 3 } },
    { kind: 'pipe', position: { x: 3, y: 3 } },
  ];
  if (outputRate > 0) {
    entities.push(
      { kind: 'inserter', position: { x: 4, y: 1 }, direction: 'east' },
      ...verticalBelt(5, 'south', 4),
    );
  }
  if (inputGroups.length > 0 && outputRate === 0) {
    entities.push(
      { kind: 'inserter', position: { x: 4, y: 1 }, direction: 'west' },
      ...verticalBelt(5, 'north', 4),
    );
  }
  const westInput = inputGroups.length > (outputRate > 0 ? 0 : 1);
  if (westInput) {
    entities.push(
      { kind: 'inserter', position: { x: 0, y: 0 }, direction: 'east' },
      ...verticalBelt(-1, 'north', 4),
    );
  }
  // Keep the extra west input belt inside the design's nonnegative coordinates.
  const shifted = westInput
    ? entities.map((entity) => ({
        ...entity,
        position: { ...entity.position, x: entity.position.x + 1 },
      }))
    : entities;
  return solved({ columns: [{ entities: shifted }] });
}

function groupInputRates(
  rates: number[],
  beltCount: number,
  beltCapacity: number,
  inserterCapacity: number,
): number[][] | undefined {
  if (rates.length === 0) return [];
  if (beltCount === 0) return undefined;
  const perBeltCapacity = Math.min(beltCapacity, inserterCapacity);
  if (rates.length === 1 && rates[0] > perBeltCapacity) {
    if (beltCount < 2 || rates[0] > 2 * perBeltCapacity) return undefined;
    return [[perBeltCapacity], [rates[0] - perBeltCapacity]];
  }
  for (const size of [2, 1]) {
    const group = rates.slice(0, size);
    if (group.length !== size) continue;
    if (group.length === 2 && group.some((rate) => rate > beltCapacity / 2)) continue;
    if (sum(group) > perBeltCapacity) continue;
    const rest = groupInputRates(rates.slice(size), beltCount - 1, beltCapacity, inserterCapacity);
    if (rest) return [group, ...rest];
  }
  return undefined;
}
