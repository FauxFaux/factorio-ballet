import type { DesignDirection } from '../design.ts';
import type { TileDesignCandidate } from '../design-validation/types.ts';
import type { AllocatedTransfer } from './capacity.ts';
import type { TileMachine } from './types.ts';

/** Expand a solved surface profile. Boundary rates are per tile; the module router must supply
 * each advertised lane separately (including upstream splits when an item uses several lanes). */
export function emitSolidTile(
  machine: TileMachine,
  rotation: DesignDirection,
  allocated: AllocatedTransfer[],
): TileDesignCandidate {
  const trackXs = [...new Set(allocated.map(({ lane }) => lane.track.x))].sort((a, b) => a - b);
  const minX = Math.min(0, ...trackXs);
  const maxX = Math.max(machine.size.width - 1, ...trackXs);
  const candidate: TileDesignCandidate = {
    column: { entities: [] },
    width: maxX - minX + 1,
    pitch: machine.size.height,
    machineIds: {},
    lanes: [],
    transfers: [],
    fluids: [],
    boundary: [],
  };
  const entities = candidate.column.entities;
  for (const x of trackXs) {
    const boundary: TileDesignCandidate['boundary'][number] = {
      x: x - minX,
      kind: 'belt',
      direction: 'north',
      lanes: {},
      laneFlows: {},
    };
    for (const { lane, rate } of allocated) {
      if (lane.track.x !== x) continue;
      boundary.lanes![lane.lane] = lane.demand.resource;
      const flow = boundary.laneFlows![lane.lane] ?? { side: lane.demand.side, rate: 0 };
      flow.rate += rate;
      boundary.laneFlows![lane.lane] = flow;
    }
    candidate.boundary.push(boundary);
    for (let y = 0; y < candidate.pitch; y++) {
      const entityIndex = entities.length;
      entities.push({ kind: 'belt', position: { x: x - minX, y }, direction: 'north' });
      for (const lane of ['left', 'right'] as const) {
        const resource = boundary.lanes![lane];
        if (resource) candidate.lanes.push({ entityIndex, lane, resource });
      }
    }
  }
  const options = [...new Set(allocated.map(({ option }) => option))].sort(
    (a, b) => a.base.x - b.base.x || a.base.y - b.base.y,
  );
  for (const option of options) {
    const transfers = allocated.filter((transfer) => transfer.option === option);
    const inserterIndex = entities.length;
    entities.push({
      kind: 'inserter',
      position: { x: option.base.x - minX, y: option.base.y },
      direction: option.direction,
      ...(option.reach === 1 ? {} : { reach: option.reach }),
      ...(option.side === 'output' && machine.outputs.items.length > 1
        ? { filter: transfers[0].lane.demand.resource }
        : {}),
    });
    for (const { lane, rate } of transfers) {
      candidate.transfers.push({
        inserterIndex,
        machineId: option.machineId,
        side: option.side,
        resource: lane.demand.resource,
        beltLane: lane.lane,
        rate,
      });
    }
  }
  candidate.machineIds[entities.length] = machine.id;
  entities.push({
    kind: 'assembler',
    position: { x: -minX, y: 0 },
    size: machine.size,
    recipe: machine.id,
    direction: rotation,
  });
  return candidate;
}
