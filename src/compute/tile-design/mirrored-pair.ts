import type { DesignEntity } from '../design.ts';
import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import { oppositeDirection, orientFluidPort, positionKey } from './orientation.ts';
import { addPairItems } from './pair-items.ts';
import type { FluidAccess, TileDesignInput, TileMachineOrientation } from './types.ts';

type Pipe = Extract<DesignEntity, { kind: 'pipe' | 'underground-pipe' }>;
type Port = {
  resource: string;
  x: number;
  y: number;
  side: 'east' | 'west';
  flowSide: 'input' | 'output';
};

/** Two touching copies form one periodic unit. Both use the same resource-to-box assignment;
 * reflection changes only the physical position of the second copy's ports. */
export function mirroredFluidPair(
  input: TileDesignInput,
  visit: () => boolean,
): { candidate: TileDesignCandidate; validation: TileValidationResult } | undefined {
  const machine = input.machines[0];
  if (
    input.machines.length !== 1 ||
    !(['inputs', 'outputs'] as const).some(
      (side) => new Set(machine[side].fluids.map(({ resource }) => resource)).size >= 2,
    ) ||
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
      const accesses = [
        ...machine.inputs.fluids.map((access) => ({ access, flowSide: 'input' as const })),
        ...machine.outputs.fluids.map((access) => ({ access, flowSide: 'output' as const })),
      ];
      const ports: Port[] = [];
      let supported = true;
      for (const [copy, orientation] of orientations.entries()) {
        for (const { access, flowSide } of accesses) {
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
            flowSide,
          });
        }
      }
      if (!supported) continue;
      const resources = [...new Set(ports.map(({ resource }) => resource))].sort((a, b) => {
        const span = (resource: string) => {
          const rows = ports.filter((port) => port.resource === resource).map(({ y }) => y);
          return Math.max(...rows) - Math.min(...rows);
        };
        return span(b) - span(a) || a.localeCompare(b);
      });
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
        function emit(
          profile: Map<string, Pipe[]> | undefined,
        ): { candidate: TileDesignCandidate; validation: TileValidationResult } | undefined {
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
            const entities =
              profile?.get(resource) ??
              Array.from({ length: pitch }, (_, y): Pipe => ({ kind: 'pipe', position: { x, y } }));
            for (const entity of entities) if (!add(entity, resource)) return;
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
          return addPairItems(input, candidate, size, minX, visit);
        }
        const profile = interleavedFluidTrunks(
          ports,
          trunks,
          pitch,
          input.transport.undergroundPipeReach,
        );
        return (profile && emit(profile)) || emit(undefined);
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

/** Complementary vertical underground spans let adjacent fluid trunks pass through each
 * other's active rows. The outer trunk's pair is in the tile; the inner pair spans its seam. */
function interleavedFluidTrunks(
  ports: Port[],
  trunks: Map<string, number>,
  pitch: number,
  reach: number,
): Map<string, Pipe[]> | undefined {
  const profiles = (['input', 'output'] as const)
    .map((side) =>
      interleavedSideTrunks(
        ports.filter((port) => port.flowSide === side),
        trunks,
        pitch,
        reach,
      ),
    )
    .filter((profile): profile is Map<string, Pipe[]> => profile !== undefined);
  if (!profiles.length) return;
  if (
    profiles.length === 2 &&
    [...profiles[0].keys()].some((resource) => profiles[1].has(resource))
  )
    return;
  return new Map(profiles.flatMap((profile) => [...profile]));
}

function interleavedSideTrunks(
  matchingPorts: Port[],
  trunks: Map<string, number>,
  pitch: number,
  reach: number,
): Map<string, Pipe[]> | undefined {
  const byResource = new Map<string, Port[]>();
  for (const port of matchingPorts) {
    const group = byResource.get(port.resource) ?? [];
    group.push(port);
    byResource.set(port.resource, group);
  }
  const groups = [...byResource.values()].map((group) => group.toSorted((a, b) => a.y - b.y));
  // Each logical fluid needs one port on each of the two mirrored copies.
  if (groups.some((group) => group.length !== 2)) return;
  const outer = groups.find((group) => group[0].y === 0 && group[1].y === pitch - 1);
  if (!outer) return;
  for (const inner of groups) {
    if (inner === outer) continue;
    const profile = interleavedPairTrunks(outer, inner, trunks, pitch, reach);
    if (profile) return profile;
  }
}

function interleavedPairTrunks(
  outer: Port[],
  inner: Port[],
  trunks: Map<string, number>,
  pitch: number,
  reach: number,
): Map<string, Pipe[]> | undefined {
  const side = outer[0].side;
  const portX = outer[0].x;
  if ([...outer, ...inner].some((port) => port.side !== side || port.x !== portX)) return;
  const first = inner[0].y;
  const last = inner[1].y;
  if (first < 2 || last > pitch - 3 || last - first + 1 > reach || pitch + first - last - 3 > reach)
    return;
  const sign = side === 'east' ? 1 : -1;
  if (trunks.get(outer[0].resource) !== portX || trunks.get(inner[0].resource) !== portX + sign)
    return;
  const result = new Map<string, Pipe[]>();
  const surface = (x: number, y: number): Pipe => ({ kind: 'pipe', position: { x, y } });
  const under = (x: number, y: number, direction: 'north' | 'south'): Pipe => ({
    kind: 'underground-pipe',
    position: { x, y },
    direction,
  });
  result.set(
    outer[0].resource,
    Array.from({ length: pitch }, (_, y) => {
      if (y === first - 1) return under(portX, y, 'north');
      if (y === last + 1) return under(portX, y, 'south');
      if (y >= first && y <= last) return undefined;
      return surface(portX, y);
    }).filter((pipe): pipe is Pipe => pipe !== undefined),
  );
  const innerX = portX + sign;
  result.set(
    inner[0].resource,
    Array.from({ length: pitch }, (_, y) => {
      if (y === last + 1) return under(innerX, y, 'north');
      if (y === first - 1) return under(innerX, y, 'south');
      if (y >= first && y <= last) return surface(innerX, y);
      return undefined;
    }).filter((pipe): pipe is Pipe => pipe !== undefined),
  );
  return result;
}
