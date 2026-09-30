import type { DesignDirection, DesignPosition } from '../../design.ts';
import type { TileDesignCandidate } from '../../design-validation/types.ts';
import { oppositeDirection } from '../orientation.ts';
import type { TileDesignInput } from '../types.ts';
import type { HighAssignment } from './allocate.ts';
import { highBounds, type HighFrame } from './geometry.ts';

/** Emit only assigned belt columns and the inserters actually needed by each copy.
 * The near and far belt divide free side cells; end sites read exposed tunnel ends. */
export function emitHighTile(
  input: TileDesignInput,
  frame: HighFrame,
  assignments: HighAssignment[],
): TileDesignCandidate {
  const machine = input.machines[0];
  const { minX, width } = highBounds(
    frame,
    assignments.map(({ track }) => track),
  );
  const candidate: TileDesignCandidate = {
    width,
    pitch: frame.pitch,
    column: { entities: [] },
    machineIds: {},
    machineCopies: { [machine.id]: frame.copies },
    lanes: [],
    transfers: [],
    fluids: [],
    boundary: [],
  };
  const { entities } = candidate.column;
  for (const y of frame.machineYs) {
    candidate.machineIds[entities.length] = machine.id;
    entities.push({
      kind: 'assembler',
      position: { x: -minX, y },
      size: frame.size,
      recipe: machine.id,
      direction: frame.orientation.rotation,
      ...(frame.orientation.mirrored ? { mirrored: true } : {}),
    });
  }
  for (const { entity, resource } of frame.pipes) {
    candidate.fluids.push({ pipeIndex: entities.length, resource });
    entities.push({ ...entity, position: { x: entity.position.x - minX, y: entity.position.y } });
  }
  candidate.boundary.push(
    ...frame.trunks.map(({ x, resource }) => ({ kind: 'pipe' as const, x: x - minX, resource })),
  );
  for (const assignment of assignments.toSorted((a, b) => a.track.x - b.track.x)) {
    const { demand, track, lanes } = assignment;
    const boundary: TileDesignCandidate['boundary'][number] = {
      kind: 'belt',
      x: track.x - minX,
      direction: 'north',
      lanes: {},
      laneFlows: {},
    };
    for (const lane of lanes) {
      boundary.lanes![lane] = demand.resource;
      boundary.laneFlows![lane] = {
        side: demand.side,
        rate: (demand.rate * frame.copies) / lanes.length,
      };
    }
    candidate.boundary.push(boundary);
    for (let y = 0; y < frame.pitch; y++) {
      if (track.tunnels?.some(({ top, bottom }) => y > top && y < bottom)) continue;
      const endpoint = track.tunnels?.find(({ top, bottom }) => y === top || y === bottom);
      const entityIndex = entities.length;
      if (endpoint)
        entities.push({
          kind: 'underground-belt',
          position: { x: track.x - minX, y },
          direction: 'north',
          end: y === endpoint.top ? 'output' : 'input',
        });
      else entities.push({ kind: 'belt', position: { x: track.x - minX, y }, direction: 'north' });
      candidate.lanes.push(
        ...lanes.map((lane) => ({ entityIndex, lane, resource: demand.resource })),
      );
    }
  }

  function inserters(
    assignment: HighAssignment,
    sites: { base: DesignPosition; face: DesignDirection }[],
  ) {
    // Equal lane loads make the promised upstream split explicit in the certificate.
    const rates = assignment.lanes.map(() => assignment.demand.rate / assignment.lanes.length);
    for (const { base, face } of sites.slice(0, assignment.sites)) {
      const inserterIndex = entities.length;
      entities.push({
        kind: 'inserter',
        position: { x: base.x - minX, y: base.y },
        direction: assignment.demand.side === 'input' ? oppositeDirection(face) : face,
        ...(assignment.reach === 2 ? { reach: 2 } : {}),
        ...(assignment.demand.side === 'output' && machine.outputs.items.length > 1
          ? { filter: assignment.demand.resource }
          : {}),
      });
      let remaining = assignment.capacity;
      for (const [index, lane] of assignment.lanes.entries()) {
        const rate = Math.min(rates[index], remaining);
        if (rate <= 0) continue;
        candidate.transfers.push({
          inserterIndex,
          machineId: machine.id,
          side: assignment.demand.side,
          resource: assignment.demand.resource,
          beltLane: lane,
          rate,
        });
        rates[index] -= rate;
        remaining -= rate;
      }
    }
  }
  for (const [copy, y] of frame.machineYs.entries()) {
    for (const side of ['west', 'east'] as const) {
      const row = frame.ports.find((port) => port.side === side)?.row;
      const available = Array.from({ length: frame.size.height }, (_, offset) => offset).filter(
        (offset) => offset !== row,
      );
      const near = assignments.find(({ track }) => track.access === `${side}-near`);
      const far = assignments.find(({ track }) => track.access === `${side}-far`);
      // Mirror the row preference in the lower half of a pair, keeping end access visible.
      const nearRows = (copy === 0 ? available.toReversed() : available).slice(0, near?.sites ?? 0);
      const farRows = (copy === 0 ? available : available.toReversed()).filter(
        (offset) => !nearRows.includes(offset),
      );
      const sites = (rows: number[]) =>
        rows.map((offset) => ({
          base: { x: side === 'west' ? -1 : 3, y: y + offset },
          face: side,
        }));
      if (near) inserters(near, sites(nearRows));
      if (far) inserters(far, sites(farRows));
    }
    for (const assignment of assignments.filter(({ track }) => track.access === 'end')) {
      const sites: { base: DesignPosition; face: DesignDirection }[] = [];
      if (copy === 0) sites.push({ base: { x: assignment.track.x, y: 1 }, face: 'north' });
      if (copy === frame.copies - 1)
        sites.push({ base: { x: assignment.track.x, y: frame.pitch - 2 }, face: 'south' });
      inserters(assignment, sites);
    }
  }
  return candidate;
}
