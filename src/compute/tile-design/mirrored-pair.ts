import type { DesignEntity } from '../design.ts';
import { validateTileDesign } from '../design-validation/validate.ts';
import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import { oppositeDirection, orientFluidPort, positionKey } from './orientation.ts';
import type { FluidAccess, TileDesignInput, TileMachineOrientation } from './types.ts';

type Pipe = Extract<DesignEntity, { kind: 'pipe' | 'underground-pipe' }>;
type Port = { resource: string; x: number; y: number; side: 'east' | 'west' };

/** Two touching copies form one periodic unit. Both use the same resource-to-box assignment;
 * reflection changes only the physical position of the second copy's ports. */
export function mirroredFluidPair(
  input: TileDesignInput,
  visit: () => boolean,
): { candidate: TileDesignCandidate; validation: TileValidationResult } | undefined {
  const machine = input.machines[0];
  if (
    input.machines.length !== 1 ||
    new Set(machine.outputs.fluids.map(({ resource }) => resource)).size < 2 ||
    machine.inputs.items.length > 0 ||
    machine.outputs.items.length > 0 ||
    input.boundary.inputs.items.length > 0 ||
    input.boundary.outputs.items.length > 0 ||
    !input.envelope.primitives.includes('surface')
  )
    return;

  for (const rotation of ['north', 'east', 'south', 'west'] as const) {
    if (
      ![false, true].every((mirrored) =>
        machine.orientations.some(
          (choice) => choice.rotation === rotation && choice.mirrored === mirrored,
        ),
      )
    )
      continue;
    const swapped = rotation === 'east' || rotation === 'west';
    const size = swapped
      ? { width: machine.size.height, height: machine.size.width }
      : machine.size;
    const pitch = size.height * 2;
    if (
      pitch > input.envelope.maxPitch ||
      pitch * input.repeat.count > (input.repeat.moduleHeight ?? Infinity)
    )
      continue;
    for (const firstMirrored of [false, true]) {
      const orientations: TileMachineOrientation[] = [
        { rotation, mirrored: firstMirrored },
        { rotation, mirrored: !firstMirrored },
      ];
      const accesses = [...machine.inputs.fluids, ...machine.outputs.fluids];
      const ports: Port[] = [];
      let supported = true;
      for (const [copy, orientation] of orientations.entries()) {
        for (const access of accesses) {
          const port = horizontalPort(access, size, orientation);
          if (!port) {
            supported = false;
            break;
          }
          ports.push({
            resource: access.resource,
            x: port.x,
            y: port.y + copy * size.height,
            side: port.side,
          });
        }
      }
      if (!supported) continue;
      const resources = [...new Set(ports.map(({ resource }) => resource))].sort();
      const choices = resources.map((resource) => {
        const matching = ports.filter((port) => port.resource === resource);
        const side = matching[0].side;
        if (matching.some((port) => port.side !== side)) return [];
        const sign = side === 'east' ? 1 : -1;
        const near =
          side === 'east'
            ? Math.max(...matching.map(({ x }) => x))
            : Math.min(...matching.map(({ x }) => x));
        const limit =
          input.envelope.primitives.includes('underground') &&
          input.envelope.primitives.includes('branch')
            ? Math.min(
                input.transport.undergroundPipeReach + 2,
                input.envelope.maxWidth - size.width,
              )
            : 0;
        return Array.from({ length: limit + 1 }, (_, offset) => near + sign * offset);
      });
      if (choices.some((choice) => choice.length === 0)) continue;
      const trunks = new Map<string, number>();
      function search(
        index: number,
      ): { candidate: TileDesignCandidate; validation: TileValidationResult } | undefined {
        if (!visit()) return;
        if (index < resources.length) {
          for (const x of choices[index]) {
            if ([...trunks.values()].includes(x)) continue;
            trunks.set(resources[index], x);
            const result = search(index + 1);
            if (result) return result;
            trunks.delete(resources[index]);
          }
          return;
        }
        const pipes = new Map<string, { entity: Pipe; resource: string }>();
        function add(entity: Pipe, resource: string): boolean {
          const key = positionKey(entity.position);
          const old = pipes.get(key);
          if (old)
            return (
              old.resource === resource &&
              old.entity.kind === entity.kind &&
              (old.entity.kind !== 'underground-pipe' ||
                (entity.kind === 'underground-pipe' && old.entity.direction === entity.direction))
            );
          if (entity.position.x >= 0 && entity.position.x < size.width) return false;
          pipes.set(key, { entity, resource });
          return true;
        }
        for (const [resource, x] of trunks) {
          for (let y = 0; y < pitch; y++)
            if (!add({ kind: 'pipe', position: { x, y } }, resource)) return;
        }
        for (const port of ports) {
          const trunkX = trunks.get(port.resource)!;
          const sign = port.side === 'east' ? 1 : -1;
          const distance = (trunkX - port.x) * sign;
          if (distance < 0) return;
          if (distance === 1) {
            if (!add({ kind: 'pipe', position: { x: port.x, y: port.y } }, port.resource)) return;
          } else if (distance > 1) {
            if (
              distance - 2 > input.transport.undergroundPipeReach ||
              !add(
                {
                  kind: 'underground-pipe',
                  position: { x: port.x, y: port.y },
                  direction: oppositeDirection(port.side),
                },
                port.resource,
              ) ||
              !add(
                {
                  kind: 'underground-pipe',
                  position: { x: trunkX - sign, y: port.y },
                  direction: port.side,
                },
                port.resource,
              )
            )
              return;
          }
        }
        const xs = [
          0,
          size.width - 1,
          ...trunks.values(),
          ...[...pipes.values()].map(({ entity }) => entity.position.x),
        ];
        const minX = Math.min(...xs);
        const width = Math.max(...xs) - minX + 1;
        if (width > input.envelope.maxWidth) return;
        const candidate: TileDesignCandidate = {
          width,
          pitch,
          column: { entities: [] },
          machineIds: {},
          lanes: [],
          transfers: [],
          fluids: [],
          boundary: [...trunks].map(([resource, x]) => ({ kind: 'pipe', x: x - minX, resource })),
        };
        for (const [copy, orientation] of orientations.entries()) {
          const entityIndex = candidate.column.entities.length;
          candidate.machineIds[entityIndex] = machine.id;
          candidate.column.entities.push({
            kind: 'assembler',
            position: { x: -minX, y: copy * size.height },
            size,
            recipe: machine.id,
            direction: orientation.rotation,
            ...(orientation.mirrored ? { mirrored: true } : {}),
          });
        }
        for (const { entity, resource } of pipes.values()) {
          candidate.fluids.push({ pipeIndex: candidate.column.entities.length, resource });
          candidate.column.entities.push({
            ...entity,
            position: { x: entity.position.x - minX, y: entity.position.y },
          });
        }
        const validation = validateTileDesign(input, candidate);
        return validation.valid ? { candidate, validation } : undefined;
      }
      const result = search(0);
      if (result) return result;
    }
  }
}

function horizontalPort(
  access: FluidAccess,
  size: { width: number; height: number },
  orientation: TileMachineOrientation,
): { x: number; y: number; side: 'east' | 'west' } | undefined {
  for (const source of access.positions) {
    const port = orientFluidPort(source, size, orientation);
    if (port.direction === 'east' || port.direction === 'west')
      return { ...port.position, side: port.direction };
  }
}

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
