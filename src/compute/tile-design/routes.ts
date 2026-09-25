import type { DesignEntity } from '../design.ts';
import { validateFluids } from '../design-validation/fluids.ts';
import type { TileDesignCandidate } from '../design-validation/types.ts';
import type { FluidId, TileDesignInput } from './types.ts';
import { oppositeDirection, orientFluidPort, positionKey } from './orientation.ts';
import type { SolidTrack, SolidTrackFrame } from './tracks.ts';

type Pipe = Extract<DesignEntity, { kind: 'pipe' | 'underground-pipe' }>;
export interface FluidRoute {
  pipes: { entity: Pipe; resource: FluidId }[];
  trunks: { x: number; resource: FluidId }[];
}
export interface RoutedFrame extends SolidTrackFrame {
  fluid: FluidRoute;
}

/** Choose physical ports and horizontal branches before allocating the remaining inserter sites.
 * All geometry is relative to the machine. Uniform pitch and in-tile tunnels are deliberate:
 * future adapters can supply other route primitives without changing the allocation contract. */
export function* routeFrames(
  input: TileDesignInput,
  frame: SolidTrackFrame,
  visit: () => boolean,
): Generator<RoutedFrame> {
  const { machine } = frame;
  const height = machine.size.height;
  const groups = new Map<string, typeof machine.inputs.fluids>();
  for (const [side, accesses] of [
    ['input', machine.inputs.fluids],
    ['output', machine.outputs.fluids],
  ] as const) {
    for (const access of accesses) {
      const key = `${side}:${access.resource}`;
      const group = groups.get(key) ?? [];
      group.push(access);
      groups.set(key, group);
    }
  }
  const domains = [...groups.values()]
    .map((accesses) => {
      const routes: FluidRoute[] = [];
      const seen = new Set<string>();
      for (const access of accesses)
        for (const source of access.positions) {
          const port = orientFluidPort(source, machine.size, frame);
          const { x, y } = port.position;
          if ((port.direction !== 'east' && port.direction !== 'west') || y < 0 || y >= height)
            continue;
          const sign = port.direction === 'east' ? 1 : -1;
          // First choice is the adjacent trunk. Other choices have a pair and a trunk one cell
          // beyond its outer endpoint. Reach counts hidden cells, as for underground belts.
          const limit =
            input.envelope.primitives.includes('underground') &&
            input.envelope.primitives.includes('branch')
              ? Math.min(
                  input.transport.undergroundPipeReach + 2,
                  input.envelope.maxWidth - machine.size.width,
                )
              : 0;
          for (let offset = 0; offset <= limit; offset++) {
            const trunkX = x + sign * offset;
            const pipes: FluidRoute['pipes'] = Array.from({ length: height }, (_, row) => ({
              entity: { kind: 'pipe', position: { x: trunkX, y: row } },
              resource: access.resource,
            }));
            if (offset === 1) {
              // A trunk one tile beyond the port connects through a surface pipe at the
              // port itself; no underground pair is needed for this short branch.
              pipes.push({
                entity: { kind: 'pipe', position: { x, y } },
                resource: access.resource,
              });
            } else if (offset > 1)
              pipes.push(
                {
                  entity: {
                    kind: 'underground-pipe',
                    position: { x, y },
                    direction: oppositeDirection(port.direction),
                  },
                  resource: access.resource,
                },
                {
                  entity: {
                    kind: 'underground-pipe',
                    position: { x: trunkX - sign, y },
                    direction: port.direction,
                  },
                  resource: access.resource,
                },
              );
            const key = JSON.stringify(pipes);
            if (seen.has(key)) continue;
            seen.add(key);
            routes.push({ pipes, trunks: [{ x: trunkX, resource: access.resource }] });
          }
        }
      return { access: accesses[0], routes };
    })
    .sort(
      (a, b) =>
        a.routes.length - b.routes.length ||
        a.access.resource.localeCompare(b.access.resource) ||
        a.access.boxIndex - b.access.boxIndex,
    );

  function* choose(index: number, fluid: FluidRoute): Generator<RoutedFrame> {
    if (index < domains.length) {
      for (const route of domains[index].routes) {
        if (!visit()) return;
        const merged = mergeRoutes(fluid, route);
        if (!merged || rectangleWidth(merged) > input.envelope.maxWidth) continue;
        yield* choose(index + 1, merged);
      }
      return;
    }
    // Check real connectivity, including unselected ports, before expensive item allocation.
    const entity = {
      kind: 'assembler' as const,
      position: { x: 0, y: 0 },
      size: machine.size,
      recipe: machine.id,
      direction: frame.rotation,
      mirrored: frame.mirrored,
    };
    const partial: TileDesignCandidate = {
      width: rectangleWidth(fluid),
      pitch: height,
      column: { entities: [entity, ...fluid.pipes.map(({ entity }) => entity)] },
      fluids: fluid.pipes.map(({ resource }, index) => ({ pipeIndex: index + 1, resource })),
      boundary: fluid.trunks.map((trunk) => ({ ...trunk, kind: 'pipe' })),
      lanes: [],
      transfers: [],
      machineIds: { 0: machine.id },
    };
    let valid = true;
    // Ports are still prototype-local; the frame's size is rotated for the placement.
    validateFluids(input, partial, new Map([[0, { entity, machine }]]), () => {
      valid = false;
    });
    if (!valid) return;
    const occupied = new Set(fluid.pipes.map(({ entity }) => positionKey(entity.position)));
    const tracks: SolidTrack[] = [];
    function* profiles(index: number): Generator<RoutedFrame> {
      if (index === frame.tracks.length) {
        const isBelt = (x: number, y: number) =>
          tracks.some(
            (track) =>
              track.x === x && !track.tunnels?.some(({ top, bottom }) => y > top && y < bottom),
          );
        const options = frame.options.filter(
          ({ base, belt }) =>
            !occupied.has(positionKey(base)) && !isBelt(base.x, base.y) && isBelt(belt.x, belt.y),
        );
        yield {
          ...frame,
          tracks: [...tracks],
          options,
          fluid,
          area: rectangleWidth(fluid) * height,
        };
        return;
      }
      const track = frame.tracks[index];
      const blocked = fluid.pipes
        .filter(({ entity }) => entity.position.x === track.x)
        .map(({ entity }) => entity.position.y);
      for (const tunnels of tunnelProfiles(blocked, height, input, visit)) {
        tracks.push({ ...track, profile: tunnels.length ? 'underground' : 'surface', tunnels });
        yield* profiles(index + 1);
        tracks.pop();
      }
    }
    yield* profiles(0);
  }
  function rectangleWidth(fluid: FluidRoute): number {
    const xs = [
      ...frame.tracks.map(({ x }) => x),
      ...fluid.pipes.map(({ entity }) => entity.position.x),
    ];
    return Math.max(machine.size.width - 1, ...xs) - Math.min(0, ...xs) + 1;
  }
  yield* choose(0, { pipes: [], trunks: [] });
}

function mergeRoutes(a: FluidRoute, b: FluidRoute): FluidRoute | undefined {
  const pipes = new Map(a.pipes.map((pipe) => [positionKey(pipe.entity.position), pipe]));
  for (const pipe of b.pipes) {
    const key = positionKey(pipe.entity.position);
    const old = pipes.get(key);
    if (
      old &&
      (old.resource !== pipe.resource ||
        old.entity.kind !== pipe.entity.kind ||
        (old.entity.kind === 'underground-pipe' &&
          pipe.entity.kind === 'underground-pipe' &&
          old.entity.direction !== pipe.entity.direction))
    )
      return;
    pipes.set(key, pipe);
  }
  const trunks = new Map(a.trunks.map((trunk) => [trunk.x, trunk]));
  for (const trunk of b.trunks) {
    if (trunks.has(trunk.x) && trunks.get(trunk.x)!.resource !== trunk.resource) return;
    trunks.set(trunk.x, trunk);
  }
  return { pipes: [...pipes.values()], trunks: [...trunks.values()] };
}

/** Enumerate non-overlapping, in-tile tunnels covering every obstruction. Each tunnel must
 * cover an obstruction; endpoint choices trade exposed access against entity count. */
function* tunnelProfiles(
  blocked: number[],
  height: number,
  input: TileDesignInput,
  visit: () => boolean,
): Generator<NonNullable<SolidTrack['tunnels']>> {
  if (!blocked.length) {
    yield [];
    return;
  }
  if (!input.envelope.primitives.includes('underground')) return;
  const rows = [...new Set(blocked)].sort((a, b) => a - b);
  const tunnels: NonNullable<SolidTrack['tunnels']> = [];
  function* choose(index: number, previous: number): Generator<NonNullable<SolidTrack['tunnels']>> {
    if (index === rows.length) {
      yield [...tunnels];
      return;
    }
    for (let top = rows[index] - 1; top > previous; top--) {
      for (
        let bottom = rows[index] + 1;
        bottom < height && bottom - top - 1 <= input.transport.undergroundBeltReach;
        bottom++
      ) {
        if (!visit()) return;
        if (rows.includes(bottom)) continue;
        tunnels.push({ top, bottom });
        const next = rows.findIndex((row) => row > bottom);
        yield* choose(next < 0 ? rows.length : next, bottom);
        tunnels.pop();
      }
    }
  }
  yield* choose(0, -1);
}
