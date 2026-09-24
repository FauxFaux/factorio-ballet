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

/** Reconstruct the periodic fluid network. Underground pairs are wholly owned by one tile;
 * exposed adjacency wraps at the seam. */
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
          ? candidate.pitch
          : candidate.width,
      );
      distance++
    ) {
      const otherIndex = pipeAt.get(
        key({
          x: entity.position.x + vector.x * distance,
          y: entity.position.y + vector.y * distance,
        }),
      );
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
  const obligations = [...assemblers.values()].flatMap(({ entity, machine }) =>
    [...machine.inputs.fluids, ...machine.outputs.fluids].map((access) => ({
      access,
      machine,
      pipes: access.positions.flatMap((port) => {
        const index = portPipeIndex(entity, port);
        return index === undefined ? [] : [index];
      }),
    })),
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
    const index = pipeAt.get(`${track.x},0`);
    const oppositeEnd = pipeAt.get(`${track.x},${candidate.pitch - 1}`);
    if (index === undefined || oppositeEnd === undefined) continue;
    const top = entities[index];
    const bottom = entities[oppositeEnd];
    if (
      (top.kind !== 'pipe' && (top.kind !== 'underground-pipe' || top.direction !== 'north')) ||
      (bottom.kind !== 'pipe' &&
        (bottom.kind !== 'underground-pipe' || bottom.direction !== 'south'))
    ) {
      issue('boundary-continuity', `Pipe track at x=${track.x} has no exposed seam.`);
      continue;
    }
    if (root(index) !== root(oppositeEnd))
      issue('boundary-continuity', `Pipe track at x=${track.x} is disconnected.`);
    // Every row must carry this fluid on the surface or below it in a paired vertical span.
    // A seam edge alone cannot stand in for a through trunk inside a finite tile.
    for (let y = 0; y < candidate.pitch; y++) {
      const row = pipeAt.get(`${track.x},${y}`);
      const exposed =
        row !== undefined &&
        fluidByRoot.get(root(row)) === track.resource &&
        (entities[row].kind === 'pipe' ||
          (entities[row].kind === 'underground-pipe' &&
            ['north', 'south'].includes(entities[row].direction)));
      const buried = [...nearest].some(([end, partner]) => {
        const pipe = entities[end];
        const mate = entities[partner];
        return (
          pipe.kind === 'underground-pipe' &&
          mate.kind === 'underground-pipe' &&
          (pipe.direction === 'north' || pipe.direction === 'south') &&
          pipe.position.x === track.x &&
          fluidByRoot.get(root(end)) === track.resource &&
          Math.min(pipe.position.y, mate.position.y) < y &&
          y < Math.max(pipe.position.y, mate.position.y)
        );
      });
      if (!exposed && !buried)
        issue('unsupported-pipe-route', 'Boundary pipe has an uncovered row.');
    }
    if (fluidByRoot.get(root(index)) !== track.resource)
      issue(
        'boundary-fluid',
        'Boundary pipe network has a different fluid.',
        index,
        track.resource,
      );
    else boundaryRoots.add(root(index));
  }
  for (const { access, machine, pipes } of obligations) {
    for (const pipe of pipes)
      if (fluidByRoot.get(root(pipe)) !== access.resource)
        issue(
          'fluid-port-mixing',
          `A pipe touches an incompatible ${access.resource} fluid box.`,
          pipe,
          access.resource,
        );
    if (
      !pipes.some(
        (pipe) => fluidByRoot.get(root(pipe)) === access.resource && boundaryRoots.has(root(pipe)),
      )
    )
      issue(
        'fluid-port',
        `Machine ${machine.id} has no boundary-connected port for ${access.resource}.`,
        undefined,
        access.resource,
      );
  }
}
