import type { DesignAssembler, DesignDirection, DesignPosition } from '../design.ts';
import type { FluidAccess, TileMachine } from '../tile-design/types.ts';
import type { TileDesignCandidate } from './types.ts';

type ReportIssue = (code: string, message: string, index?: number, resource?: string) => void;

const vectors: Record<DesignDirection, DesignPosition> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};
const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
const key = ({ x, y }: DesignPosition) => `${x},${y}`;
const add = (a: DesignPosition, b: DesignPosition) => ({ x: a.x + b.x, y: a.y + b.y });
const opposite = (direction: DesignDirection) =>
  directions[(directions.indexOf(direction) + 2) % 4];

export function validateFluids(
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
  const parent = new Map<number, number>();
  const root = (index: number): number => {
    const p = parent.get(index);
    if (p === undefined || p === index) return index;
    const r = root(p);
    parent.set(index, r);
    return r;
  };
  const join = (a: number, b: number) => parent.set(root(a), root(b));
  for (const index of pipeAt.values()) {
    parent.set(index, index);
    const entity = entities[index];
    for (const direction of directions) {
      if (entity.kind === 'underground-pipe' && entity.direction !== direction) continue;
      const neighbor = pipeAt.get(key(add(entity.position, vectors[direction])));
      if (neighbor === undefined) continue;
      const other = entities[neighbor];
      if (other.kind === 'underground-pipe' && other.direction !== opposite(direction)) continue;
      join(index, neighbor);
    }
  }
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
  for (const track of candidate.boundary)
    if (track.kind === 'pipe') {
      const index = pipeAt.get(`${track.x},0`);
      const oppositeEnd = pipeAt.get(`${track.x},${candidate.pitch - 1}`);
      if (index !== undefined && oppositeEnd !== undefined && root(index) !== root(oppositeEnd))
        issue('boundary-continuity', `Pipe track at x=${track.x} is disconnected.`);
      if (index !== undefined && fluidByRoot.get(root(index)) !== track.resource)
        issue(
          'boundary-fluid',
          'Boundary pipe network has a different fluid.',
          index,
          track.resource,
        );
    }
  for (const { entity, machine } of assemblers.values())
    for (const side of ['input', 'output'] as const) {
      for (const access of (side === 'input' ? machine.inputs : machine.outputs).fluids) {
        for (const port of access.positions) {
          const pipe = portPipeIndex(entity, port, pipeAt);
          if (pipe !== undefined && fluidByRoot.get(root(pipe)) !== access.resource)
            issue(
              'fluid-port-mixing',
              `A pipe touches an incompatible ${access.resource} fluid box.`,
              pipe,
              access.resource,
            );
        }
        if (
          !access.positions.some((port) =>
            portPipe(entity, access, port, pipeAt, root, fluidByRoot),
          )
        )
          issue(
            'fluid-port',
            `Machine ${machine.id} has no connected ${side} port for ${access.resource}.`,
            undefined,
            access.resource,
          );
      }
    }
  if (entities.some((entity) => entity.kind === 'underground-pipe'))
    issue('unsupported-entity', 'Underground pipe pairing is not yet validated.');
}

function portPipe(
  entity: DesignAssembler,
  access: FluidAccess,
  port: FluidAccess['positions'][number],
  pipeAt: Map<string, number>,
  root: (index: number) => number,
  fluidByRoot: Map<number, string>,
): boolean {
  const index = portPipeIndex(entity, port, pipeAt);
  return index !== undefined && fluidByRoot.get(root(index)) === access.resource;
}

function portPipeIndex(
  entity: DesignAssembler,
  port: FluidAccess['positions'][number],
  pipeAt: Map<string, number>,
): number | undefined {
  const turns = directions.indexOf(entity.direction ?? 'north');
  let position = { ...port.position };
  for (let turn = 0; turn < turns; turn++) position = { x: -position.y, y: position.x };
  const direction = directions[(directions.indexOf(port.direction) + turns) % 4];
  const face = {
    x: entity.position.x + entity.size.width / 2 + position.x - 0.5,
    y: entity.position.y + entity.size.height / 2 + position.y - 0.5,
  };
  return pipeAt.get(key(add(face, vectors[direction])));
}
