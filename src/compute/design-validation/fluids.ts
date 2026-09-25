import type { DesignAssembler, DesignPosition } from '../design.ts';
import type { FluidAccess, TileMachine } from '../tile-design/types.ts';
import {
  cardinalDirections as directions,
  directionVectors as vectors,
  oppositeDirection as opposite,
  orientFluidPort,
  positionKey as key,
} from '../tile-design/orientation.ts';
import type { TileDesignCandidate, TileValidationInput } from './types.ts';

type ReportIssue = (code: string, message: string, index?: number, resource?: string) => void;

/** Reconstruct the periodic fluid network, including vertical underground spans crossing a seam. */
export function validateFluids(
  input: TileValidationInput,
  candidate: TileDesignCandidate,
  assemblers: Map<number, { entity: DesignAssembler; machine: TileMachine }>,
  issue: ReportIssue,
) {
  const { entities } = candidate.column;
  const pipeAt = new Map<string, number>();
  entities.forEach((entity, index) => {
    if (entity.kind === 'pipe' || entity.kind === 'underground-pipe')
      pipeAt.set(key(entity.position), index);
  });
  const parent = new Map([...pipeAt.values()].map((index) => [index, index]));
  const root = (index: number): number => {
    const p = parent.get(index)!;
    if (p === index) return index;
    const r = root(p);
    parent.set(index, r);
    return r;
  };
  const join = (a: number, b: number) => parent.set(root(a), root(b));
  const wrap = (position: DesignPosition) => ({
    ...position,
    y: ((position.y % candidate.pitch) + candidate.pitch) % candidate.pitch,
  });
  for (const index of pipeAt.values()) {
    const entity = entities[index];
    for (const direction of directions) {
      if (entity.kind === 'underground-pipe' && entity.direction !== direction) continue;
      const vector = vectors[direction];
      const neighbor = pipeAt.get(
        key(wrap({ x: entity.position.x + vector.x, y: entity.position.y + vector.y })),
      );
      if (neighbor === undefined) continue;
      const other = entities[neighbor];
      if (other.kind === 'underground-pipe' && other.direction !== opposite(direction)) continue;
      join(index, neighbor);
    }
  }
  const nearest = new Map<number, number>();
  for (const index of pipeAt.values()) {
    const entity = entities[index];
    if (entity.kind !== 'underground-pipe') continue;
    const vector = vectors[opposite(entity.direction)];
    for (
      let distance = 1;
      distance <=
      Math.min(
        input.transport.undergroundPipeReach + 1,
        entity.direction === 'north' || entity.direction === 'south'
          ? candidate.pitch - 1
          : candidate.width,
      );
      distance++
    ) {
      const position = {
        x: entity.position.x + vector.x * distance,
        y: entity.position.y + vector.y * distance,
      };
      const otherIndex = pipeAt.get(key(vector.y ? wrap(position) : position));
      if (otherIndex === undefined) continue;
      const other = entities[otherIndex];
      if (other.kind === 'underground-pipe' && other.direction === opposite(entity.direction)) {
        nearest.set(index, otherIndex);
        break;
      }
    }
  }
  for (const index of pipeAt.values()) {
    if (entities[index].kind !== 'underground-pipe') continue;
    const partner = nearest.get(index);
    if (partner === undefined || nearest.get(partner) !== index)
      issue(
        'underground-pipe-pair',
        'Pipe endpoint has no mutual nearest in-range partner.',
        index,
      );
    else join(index, partner);
  }

  function portPipeIndex(
    entity: DesignAssembler,
    port: FluidAccess['positions'][number],
  ): number | undefined {
    const oriented = orientFluidPort(port, entity.size, {
      rotation: entity.direction ?? 'north',
      mirrored: entity.mirrored ?? false,
    });
    const index = pipeAt.get(
      key(
        wrap({
          x: entity.position.x + oriented.position.x,
          y: entity.position.y + oriented.position.y,
        }),
      ),
    );
    if (index === undefined) return;
    const pipe = entities[index];
    if (pipe.kind === 'underground-pipe' && pipe.direction !== opposite(oriented.direction)) return;
    return index;
  }
  const obligations = [...assemblers].flatMap(([assemblerIndex, { entity, machine }]) =>
    (
      [
        ['input', machine.inputs.fluids],
        ['output', machine.outputs.fluids],
      ] as const
    ).flatMap(([side, accesses]) =>
      accesses.map((access) => ({
        access,
        machine,
        assemblerIndex,
        side,
        pipes: access.positions.flatMap((port) => {
          const index = portPipeIndex(entity, port);
          return index === undefined ? [] : [index];
        }),
      })),
    ),
  );
  // Alternative physical ports of a logical box connect through that box.
  for (const { pipes } of obligations) for (const index of pipes.slice(1)) join(pipes[0], index);

  const fluidByRoot = new Map<number, string>();
  for (const { pipeIndex, resource } of candidate.fluids) {
    if (!parent.has(pipeIndex)) {
      issue('fluid-entity', 'Fluid assignment refers to a non-pipe.', pipeIndex);
      continue;
    }
    const network = root(pipeIndex);
    if (fluidByRoot.has(network) && fluidByRoot.get(network) !== resource)
      issue('fluid-mixing', 'Connected pipes carry incompatible fluids.', pipeIndex, resource);
    fluidByRoot.set(network, resource);
  }
  const boundaryRoots = new Set<number>();
  for (const track of candidate.boundary) {
    if (track.kind !== 'pipe') continue;
    const topIndex = pipeAt.get(`${track.x},0`);
    const bottomIndex = pipeAt.get(`${track.x},${candidate.pitch - 1}`);
    const top = topIndex === undefined ? undefined : entities[topIndex];
    const bottom = bottomIndex === undefined ? undefined : entities[bottomIndex];
    const exposedSeam =
      topIndex !== undefined &&
      bottomIndex !== undefined &&
      (top?.kind === 'pipe' || (top?.kind === 'underground-pipe' && top.direction === 'north')) &&
      (bottom?.kind === 'pipe' ||
        (bottom?.kind === 'underground-pipe' && bottom.direction === 'south')) &&
      root(topIndex) === root(bottomIndex) &&
      fluidByRoot.get(root(topIndex)) === track.resource;
    const seamPair = [...nearest].find(([end, partner]) => {
      const pipe = entities[end];
      const mate = entities[partner];
      return (
        nearest.get(partner) === end &&
        pipe.kind === 'underground-pipe' &&
        mate.kind === 'underground-pipe' &&
        pipe.direction === 'north' &&
        mate.direction === 'south' &&
        pipe.position.x === track.x &&
        pipe.position.y > mate.position.y &&
        fluidByRoot.get(root(end)) === track.resource
      );
    });
    const anchor = seamPair?.[0] ?? (exposedSeam ? topIndex : undefined);
    if (anchor === undefined) {
      issue('boundary-continuity', `Pipe track at x=${track.x} has no connected seam.`);
      continue;
    }
    const network = root(anchor);
    // Cover each row with this network's surface pipe, endpoint, or a mutual vertical pair.
    for (let y = 0; y < candidate.pitch; y++) {
      const row = pipeAt.get(`${track.x},${y}`);
      const exposed =
        row !== undefined &&
        root(row) === network &&
        (entities[row].kind === 'pipe' ||
          (entities[row].kind === 'underground-pipe' &&
            ['north', 'south'].includes(entities[row].direction)));
      const buried = [...nearest].some(([end, partner]) => {
        const pipe = entities[end];
        if (
          nearest.get(partner) !== end ||
          pipe.kind !== 'underground-pipe' ||
          (pipe.direction !== 'north' && pipe.direction !== 'south') ||
          pipe.position.x !== track.x ||
          root(end) !== network
        )
          return false;
        const step = vectors[opposite(pipe.direction)].y;
        for (let distance = 1; distance < candidate.pitch; distance++) {
          const row = wrap({ x: track.x, y: pipe.position.y + step * distance }).y;
          if (row === entities[partner].position.y) return false;
          if (row === y) return true;
        }
        return false;
      });
      if (!exposed && !buried)
        issue('unsupported-pipe-route', 'Boundary pipe has an uncovered row.');
    }
    boundaryRoots.add(network);
  }
  for (const { access, pipes } of obligations) {
    for (const pipe of pipes)
      if (fluidByRoot.get(root(pipe)) !== access.resource)
        issue(
          'fluid-port-mixing',
          `A pipe touches an incompatible ${access.resource} fluid box.`,
          pipe,
          access.resource,
        );
  }
  const connected = new Set(
    obligations
      .filter(({ access, pipes }) =>
        pipes.some(
          (pipe) =>
            fluidByRoot.get(root(pipe)) === access.resource && boundaryRoots.has(root(pipe)),
        ),
      )
      .map(({ assemblerIndex, side, access }) => `${assemblerIndex}:${side}:${access.resource}`),
  );
  const required = new Map(
    obligations.map(({ assemblerIndex, side, access, machine }) => [
      `${assemblerIndex}:${side}:${access.resource}`,
      { access, machine },
    ]),
  );
  for (const [key, { access, machine }] of required) {
    if (!connected.has(key))
      issue(
        'fluid-port',
        `Machine ${machine.id} has no boundary-connected port for ${access.resource}.`,
        undefined,
        access.resource,
      );
  }
}
