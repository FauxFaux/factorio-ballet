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

/** Reconstruct the periodic fluid network. Horizontal pairs are wholly owned by one tile;
 * surface adjacency wraps at the seam. Vertical underground phases need a later certificate. */
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
    if (entity.direction !== 'east' && entity.direction !== 'west') {
      issue(
        'unsupported-pipe-route',
        'Only horizontal, in-tile underground pipe pairs can be certified.',
        index,
      );
      continue;
    }
    const vector = vectors[opposite(entity.direction)];
    for (
      let distance = 1;
      distance <= Math.min(input.transport.undergroundPipeReach + 1, candidate.width);
      distance++
    ) {
      const otherIndex = pipeAt.get(
        key({ x: entity.position.x + vector.x * distance, y: entity.position.y }),
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
    if (root(index) !== root(oppositeEnd))
      issue('boundary-continuity', `Pipe track at x=${track.x} is disconnected.`);
    // A seam edge alone cannot stand in for a through trunk inside each finite tile.
    for (let y = 0; y < candidate.pitch; y++) {
      const row = pipeAt.get(`${track.x},${y}`);
      if (row === undefined || entities[row].kind !== 'pipe')
        issue('unsupported-pipe-route', 'Boundary pipes must be full surface trunks.');
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
