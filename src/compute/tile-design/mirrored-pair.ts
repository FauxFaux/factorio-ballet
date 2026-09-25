import type { DesignEntity } from '../design.ts';
import { validateTileDesign } from '../design-validation/validate.ts';
import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import { oppositeDirection, orientFluidPort, positionKey } from './orientation.ts';
import { solidAccessOptions, type SolidAccessOption } from './access.ts';
import type { FluidAccess, ItemFlow, TileDesignInput, TileMachineOrientation } from './types.ts';

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

/** Add straight item tracks to a routed fluid pair. A track serves both copies with one
 * inserter per copy; validation checks their shared lane and each inserter's rate. */
function addPairItems(
  input: TileDesignInput,
  fluidCandidate: TileDesignCandidate,
  size: { width: number; height: number },
  fluidMinX: number,
  visit: () => boolean,
): { candidate: TileDesignCandidate; validation: TileValidationResult } | undefined {
  const machine = input.machines[0];
  const demands: { flow: ItemFlow; side: 'input' | 'output' }[] = [
    ...machine.inputs.items.map((flow) => ({ flow, side: 'input' as const })),
    ...machine.outputs.items.map((flow) => ({ flow, side: 'output' as const })),
  ];
  if (!demands.length) {
    const validation = validateTileDesign(input, fluidCandidate);
    return validation.valid ? { candidate: fluidCandidate, validation } : undefined;
  }
  const access = solidAccessOptions({ ...machine, size }, { x: 0, y: 0 }, input.transport).filter(
    ({ face }) => face === 'east' || face === 'west',
  );
  const pipes = fluidCandidate.column.entities.filter(
    (entity) => entity.kind === 'pipe' || entity.kind === 'underground-pipe',
  );
  const pipePositions = new Set(
    pipes.map((entity) => positionKey({ x: entity.position.x + fluidMinX, y: entity.position.y })),
  );
  const pipeXs = new Set(pipes.map((entity) => entity.position.x + fluidMinX));
  const choices = demands.map(({ flow, side }) =>
    access
      .filter(
        ({ side: optionSide, capacity, base, belt }) =>
          optionSide === side &&
          capacity >= flow.rate &&
          !pipeXs.has(belt.x) &&
          [0, size.height].every(
            (offset) => !pipePositions.has(positionKey({ x: base.x, y: base.y + offset })),
          ),
      )
      .sort(
        (a, b) =>
          Math.abs(a.belt.x - (size.width - 1) / 2) - Math.abs(b.belt.x - (size.width - 1) / 2) ||
          a.reach - b.reach ||
          a.base.y - b.base.y,
      ),
  );
  if (choices.some((options) => !options.length)) return;
  const selected: SolidAccessOption[] = [];
  function search(
    index: number,
  ): { candidate: TileDesignCandidate; validation: TileValidationResult } | undefined {
    if (!visit()) return;
    if (index < demands.length) {
      for (const option of choices[index]) {
        if (selected.some((other) => other.belt.x === option.belt.x)) continue;
        selected.push(option);
        const result = search(index + 1);
        if (result) return result;
        selected.pop();
      }
      return;
    }
    const minX = Math.min(fluidMinX, ...selected.map(({ belt, base }) => Math.min(belt.x, base.x)));
    const maxX = Math.max(
      fluidMinX + fluidCandidate.width - 1,
      ...selected.map(({ belt, base }) => Math.max(belt.x, base.x)),
    );
    if (maxX - minX + 1 > input.envelope.maxWidth) return;
    const shift = fluidMinX - minX;
    const candidate = structuredClone(fluidCandidate);
    candidate.width = maxX - minX + 1;
    for (const entity of candidate.column.entities) entity.position.x += shift;
    for (const track of candidate.boundary) track.x += shift;
    for (const [index, option] of selected.entries()) {
      const { flow, side } = demands[index];
      const x = option.belt.x - minX;
      const lane = side === 'output' && option.face === 'east' ? 'right' : 'left';
      candidate.boundary.push({
        kind: 'belt',
        x,
        direction: 'north',
        lanes: { [lane]: flow.resource },
        laneFlows: { [lane]: { side, rate: flow.rate * 2 } },
      });
      for (let y = 0; y < candidate.pitch; y++) {
        const entityIndex = candidate.column.entities.length;
        candidate.column.entities.push({ kind: 'belt', position: { x, y }, direction: 'north' });
        candidate.lanes.push({ entityIndex, lane, resource: flow.resource });
      }
      for (const copy of [0, 1]) {
        const inserterIndex = candidate.column.entities.length;
        candidate.column.entities.push({
          kind: 'inserter',
          position: { x: option.base.x - minX, y: option.base.y + copy * size.height },
          direction: option.direction,
          ...(option.reach === 1 ? {} : { reach: option.reach }),
          ...(side === 'output' && machine.outputs.items.length > 1
            ? { filter: flow.resource }
            : {}),
        });
        candidate.transfers.push({
          inserterIndex,
          machineId: machine.id,
          side,
          resource: flow.resource,
          beltLane: lane,
          rate: flow.rate,
        });
      }
    }
    const validation = validateTileDesign(input, candidate);
    return validation.valid ? { candidate, validation } : undefined;
  }
  return search(0);
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
