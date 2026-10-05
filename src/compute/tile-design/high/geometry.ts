import type { DesignEntity, DesignSize } from '../../design.ts';
import { oppositeDirection, orientFluidPort } from '../orientation.ts';
import type { SolidTrack } from '../tracks.ts';
import type { FluidId, TileDesignInput, TileMachineOrientation } from '../types.ts';

type Pipe = Extract<DesignEntity, { kind: 'pipe' | 'underground-pipe' }>;
export interface HighPort {
  resource: FluidId;
  side: 'west' | 'east';
  row: number;
}
export interface HighTrack extends SolidTrack {
  /** End belts have one site on each outer end. Side belts share the edge's free cells. */
  access: 'west-near' | 'west-far' | 'end' | 'east-near' | 'east-far';
}
export interface HighFrame {
  size: DesignSize;
  orientation: TileMachineOrientation;
  copies: 1 | 2;
  pitch: number;
  machineYs: number[];
  tracks: HighTrack[];
  sideRows: Record<'west' | 'east', number[]>;
  pipes: { entity: Pipe; resource: FluidId }[];
  trunks: { x: number; resource: FluidId }[];
}

/** Up to seven columns: four side belts and three tunnels under the machine(s).
 * Fluid sides try an adjacent trunk, one ordinary-reach belt, or two side belts. */
export function* highFrames(
  input: TileDesignInput,
  copies: 1 | 2,
  visit: () => boolean,
): Generator<HighFrame> {
  const machine = input.machines[0];
  const orientations = machine.orientations.toSorted(
    (a, b) => a.rotation.localeCompare(b.rotation) || Number(a.mirrored) - Number(b.mirrored),
  );
  const seen = new Set<string>();
  for (const orientation of orientations) {
    const swapped = orientation.rotation === 'east' || orientation.rotation === 'west';
    const size = swapped
      ? { width: machine.size.height, height: machine.size.width }
      : machine.size;
    if (size.width !== 3) continue;
    const pitch = size.height * copies + 4;
    if (
      pitch > input.envelope.maxPitch ||
      pitch * input.repeat.count > (input.repeat.moduleHeight ?? Infinity)
    )
      continue;
    const groups = new Map<string, HighPort[]>();
    for (const [side, accesses] of [
      ['input', machine.inputs.fluids],
      ['output', machine.outputs.fluids],
    ] as const) {
      for (const access of accesses) {
        const key = `${side}:${access.resource}`;
        const ports = groups.get(key) ?? [];
        groups.set(key, ports);
        for (const source of access.positions) {
          const port = orientFluidPort(source, size, orientation);
          if (
            (port.direction === 'west' || port.direction === 'east') &&
            port.position.y > 0 &&
            port.position.y < size.height - 1
          )
            ports.push({ resource: access.resource, side: port.direction, row: port.position.y });
        }
      }
    }
    if (groups.size > 2) continue;
    const domains = [...groups]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([, ports]) => ports.toSorted((a, b) => a.side.localeCompare(b.side) || a.row - b.row));
    function* choose(ports: HighPort[], index: number): Generator<HighFrame> {
      if (!visit()) return;
      if (index < domains.length) {
        for (const port of domains[index]) {
          // One trunk per side; distinct fluids must have isolated surface networks.
          if (ports.some((other) => other.side === port.side)) continue;
          yield* choose([...ports, port], index + 1);
        }
        return;
      }
      const signature = JSON.stringify([size, orientation, ports]);
      if (seen.has(signature)) return;
      seen.add(signature);
      yield* routeHighFrames(input, size, orientation, copies, pitch, ports, visit);
    }
    yield* choose([], 0);
  }
}

/** Each route changes actual belt access and occupied inserter cells before matching. */
function* routeHighFrames(
  input: TileDesignInput,
  size: DesignSize,
  orientation: TileMachineOrientation,
  copies: 1 | 2,
  pitch: number,
  ports: HighPort[],
  visit: () => boolean,
): Generator<HighFrame> {
  type Route = 'adjacent' | 'compact' | 'double';
  function* choose(routes: Route[]): Generator<HighFrame> {
    if (routes.length < ports.length) {
      for (const route of ['adjacent', 'compact', 'double'] as const) {
        if (
          route !== 'adjacent' &&
          (!input.envelope.primitives.includes('branch') ||
            !input.envelope.primitives.includes('underground') ||
            input.transport.undergroundBeltReach < 1 ||
            input.transport.undergroundPipeReach < (route === 'double' ? 1 : 0))
        )
          continue;
        yield* choose([...routes, route]);
      }
      return;
    }
    if (!visit()) return;
    const machineYs = Array.from({ length: copies }, (_, copy) => 2 + copy * size.height);
    const pipes: HighFrame['pipes'] = [];
    const trunks: HighFrame['trunks'] = [];
    const rows = Array.from({ length: size.height }, (_, row) => row);
    const sideRows: HighFrame['sideRows'] = { west: rows, east: rows };
    let tracks: HighTrack[] = [
      { x: -3, access: 'west-far', direction: 'north', profile: 'surface' },
      { x: -2, access: 'west-near', direction: 'north', profile: 'surface' },
      ...[0, 1, 2].map((x): HighTrack => ({
        x,
        access: 'end',
        direction: 'north',
        profile: 'underground',
        tunnels: [{ top: 0, bottom: pitch - 1 }],
      })),
      { x: 4, access: 'east-near', direction: 'north', profile: 'surface' },
      { x: 5, access: 'east-far', direction: 'north', profile: 'surface' },
    ];
    for (const [index, port] of ports.entries()) {
      const route = routes[index];
      const x = port.side === 'west' ? -1 : 3;
      const sign = port.side === 'west' ? -1 : 1;
      const outerX = x + sign * (route === 'double' ? 2 : 1);
      const trunkX = route === 'adjacent' ? x : outerX + sign;
      trunks.push({ x: trunkX, resource: port.resource });
      for (let y = 0; y < pitch; y++)
        pipes.push({
          entity: { kind: 'pipe', position: { x: trunkX, y } },
          resource: port.resource,
        });
      if (route === 'adjacent') {
        sideRows[port.side] = [];
        tracks = tracks.filter(({ access }) => !access.startsWith(port.side));
        continue;
      }
      sideRows[port.side] = rows.filter((row) => row !== port.row);
      if (route === 'compact')
        tracks = tracks.filter(({ access }) => access !== `${port.side}-far`);
      const track = tracks.find(
        ({ access }) => access === `${port.side}-${route === 'double' ? 'far' : 'near'}`,
      )!;
      track.profile = 'underground';
      track.tunnels = machineYs.map((y) => ({ top: y + port.row - 1, bottom: y + port.row + 1 }));
      for (const machineY of machineYs) {
        const y = machineY + port.row;
        pipes.push(
          {
            entity: {
              kind: 'underground-pipe',
              position: { x, y },
              direction: oppositeDirection(port.side),
            },
            resource: port.resource,
          },
          {
            entity: { kind: 'underground-pipe', position: { x: outerX, y }, direction: port.side },
            resource: port.resource,
          },
        );
      }
    }
    yield { size, orientation, copies, pitch, machineYs, tracks, sideRows, pipes, trunks };
  }
  yield* choose([]);
}

export function highBounds(frame: HighFrame, tracks: HighTrack[]) {
  const xs = [
    0,
    frame.size.width - 1,
    ...tracks.map(({ x }) => x),
    ...frame.pipes.map(({ entity }) => entity.position.x),
  ];
  const minX = Math.min(...xs);
  return { minX, width: Math.max(...xs) - minX + 1 };
}
