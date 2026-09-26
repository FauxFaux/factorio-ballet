import { validateTileDesign } from '../design-validation/validate.ts';
import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import type { TileDesignInput } from './types.ts';

/** Join two independently routed halves only when every through track lines up. The full
 * validator checks their shared seam and the doubled item rates after composition. */
export function stackMirroredTiles(
  input: TileDesignInput,
  first: TileDesignCandidate,
  second: TileDesignCandidate,
): { candidate: TileDesignCandidate; validation: TileValidationResult } | undefined {
  const sorted = (candidate: TileDesignCandidate) =>
    [...candidate.boundary].sort((a, b) => a.x - b.x);
  const a = sorted(first);
  const b = sorted(second);
  if (a.length !== b.length || !a.length) return;
  const delta = a[0].x - b[0].x;
  const signature = (track: TileDesignCandidate['boundary'][number]) =>
    JSON.stringify([track.kind, track.direction, track.resource, track.lanes]);
  if (
    a.some(
      (track, index) => track.x !== b[index].x + delta || signature(track) !== signature(b[index]),
    )
  )
    return;
  const minX = Math.min(0, delta);
  const width = Math.max(first.width - 1, delta + second.width - 1) - minX + 1;
  const pitch = first.pitch + second.pitch;
  if (
    width > input.envelope.maxWidth ||
    pitch > input.envelope.maxPitch ||
    pitch * input.repeat.count > (input.repeat.moduleHeight ?? Infinity)
  )
    return;
  const candidate: TileDesignCandidate = {
    width,
    pitch,
    column: { entities: [] },
    machineIds: {},
    lanes: [],
    transfers: [],
    fluids: [],
    boundary: first.boundary.map((track) => ({
      ...track,
      x: track.x - minX,
      ...(track.laneFlows ? { laneFlows: structuredClone(track.laneFlows) } : {}),
    })),
  };
  for (const [half, xOffset, yOffset] of [
    [first, -minX, 0],
    [second, delta - minX, first.pitch],
  ] as const) {
    const indexOffset = candidate.column.entities.length;
    candidate.column.entities.push(
      ...half.column.entities.map((entity) => ({
        ...entity,
        position: { x: entity.position.x + xOffset, y: entity.position.y + yOffset },
      })),
    );
    for (const [index, id] of Object.entries(half.machineIds))
      candidate.machineIds[Number(index) + indexOffset] = id;
    candidate.lanes.push(
      ...half.lanes.map((lane) => ({
        ...lane,
        entityIndex: lane.entityIndex + indexOffset,
      })),
    );
    candidate.transfers.push(
      ...half.transfers.map((transfer) => ({
        ...transfer,
        inserterIndex: transfer.inserterIndex + indexOffset,
      })),
    );
    candidate.fluids.push(
      ...half.fluids.map((fluid) => ({
        ...fluid,
        pipeIndex: fluid.pipeIndex + indexOffset,
      })),
    );
  }
  for (const track of candidate.boundary) {
    if (track.kind !== 'belt') continue;
    const mate = second.boundary.find(
      (other) => other.kind === 'belt' && other.x + delta - minX === track.x,
    );
    if (!mate) return;
    for (const lane of ['left', 'right'] as const) {
      const flow = track.laneFlows?.[lane];
      const added = mate.laneFlows?.[lane];
      if (flow && added && flow.side === added.side) flow.rate += added.rate;
      else if (flow || added) return;
    }
  }
  const validation = validateTileDesign(input, candidate);
  return validation.valid ? { candidate, validation } : undefined;
}
