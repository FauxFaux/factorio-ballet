import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import { validateTileDesign } from '../design-validation/validate.ts';
import type { DesignEntity } from '../design.ts';
import { solidAccessOptions } from './access.ts';
import { firstSolidTrack, type SolidTrackChoice } from './tracks.ts';
import type { TileDesignInput } from './types.ts';

export type TileDesignSearchResult =
  | { status: 'found'; candidate: TileDesignCandidate; validation: TileValidationResult }
  | { status: 'unsupported' | 'first-choice-rejected'; reason: string };

/** Starter one-machine allocator: fixed placement and first-fit west/east surface trunks. */
export function solveTileDesign(input: TileDesignInput): TileDesignSearchResult {
  const machine = input.machines[0];
  if (
    input.machines.length !== 1 ||
    !machine ||
    machine.inputs.fluids.length ||
    machine.outputs.fluids.length
  )
    return { status: 'unsupported', reason: 'Only one solid-only machine is supported.' };
  if (!input.envelope.primitives.includes('surface'))
    return { status: 'unsupported', reason: 'Surface belts are required.' };
  if (machine.inputs.items.length !== 1 || machine.outputs.items.length !== 1)
    return { status: 'unsupported', reason: 'One input item and one output item are supported.' };
  const inputFlow = machine.inputs.items[0]!;
  const outputFlow = machine.outputs.items[0]!;
  if (
    input.boundary.inputs.items.length !== 1 ||
    input.boundary.outputs.items.length !== 1 ||
    input.boundary.inputs.items[0]?.resource !== inputFlow.resource ||
    input.boundary.outputs.items[0]?.resource !== outputFlow.resource ||
    input.boundary.inputs.items[0]?.rate !== inputFlow.rate ||
    input.boundary.outputs.items[0]?.rate !== outputFlow.rate
  )
    return {
      status: 'unsupported',
      reason: 'Only external, directly supplied item flows are supported.',
    };

  const firstRule = input.transport.inserters[0]!;
  if (firstRule.reach !== 1 && firstRule.reach !== 2)
    return { status: 'unsupported', reason: 'Only one- and two-tile inserter reach is supported.' };
  const width = machine.size.width + 4 * firstRule.reach;
  const pitch = machine.size.height;
  if (width > input.envelope.maxWidth || pitch > input.envelope.maxPitch)
    return {
      status: 'first-choice-rejected',
      reason: 'The fixed machine and direct trunks exceed the envelope.',
    };
  if (
    input.repeat.moduleHeight !== undefined &&
    pitch * input.repeat.count > input.repeat.moduleHeight
  )
    return {
      status: 'first-choice-rejected',
      reason: 'The requested copies exceed the physical height.',
    };

  const position = { x: 2 * firstRule.reach, y: 0 };
  const options = solidAccessOptions(machine, position, input.transport);
  const choices = [
    firstSolidTrack(
      options,
      'input',
      inputFlow.resource,
      inputFlow.rate,
      input.transport.beltLaneCapacity,
      input.repeat.count,
      width,
      pitch,
    ),
    firstSolidTrack(
      options,
      'output',
      outputFlow.resource,
      outputFlow.rate,
      input.transport.beltLaneCapacity,
      input.repeat.count,
      width,
      pitch,
    ),
  ];
  if (!choices[0] || !choices[1])
    return {
      status: 'first-choice-rejected',
      reason: 'The first direct belt or inserter allocation lacks capacity.',
    };

  const entities: DesignEntity[] = [];
  const lanes: TileDesignCandidate['lanes'] = [];
  for (const choice of choices as SolidTrackChoice[]) {
    for (let y = 0; y < pitch; y++) {
      const entityIndex = entities.length;
      entities.push({ kind: 'belt', position: { x: choice.boundary.x, y }, direction: 'north' });
      lanes.push({ entityIndex, lane: choice.lane, resource: choice.resource });
    }
  }
  const transfers: TileDesignCandidate['transfers'] = [];
  for (const [index, choice] of choices.entries()) {
    let remaining = index === 0 ? inputFlow.rate : outputFlow.rate;
    for (const option of choice!.access) {
      const rate = Math.min(remaining, option.capacity);
      const inserterIndex = entities.length;
      entities.push({
        kind: 'inserter',
        position: option.base,
        direction: option.direction,
        ...(option.reach === 1 ? {} : { reach: option.reach }),
      });
      transfers.push({
        inserterIndex,
        machineId: machine.id,
        side: option.side,
        resource: choice!.resource,
        rate,
        beltLane: choice!.lane,
      });
      remaining -= rate;
    }
  }
  const machineIndex = entities.length;
  entities.push({ kind: 'assembler', position, size: machine.size, recipe: machine.id });
  const candidate: TileDesignCandidate = {
    column: { entities },
    width,
    pitch,
    machineIds: { [machineIndex]: machine.id },
    lanes,
    transfers,
    fluids: [],
    boundary: choices.map((choice) => choice!.boundary),
  };
  const validation = validateTileDesign(input, candidate);
  if (!validation.valid)
    return {
      status: 'first-choice-rejected',
      reason: `First candidate failed validation: ${validation.issues.map(({ code }) => code).join(', ')}`,
    };
  return { status: 'found', candidate, validation };
}
