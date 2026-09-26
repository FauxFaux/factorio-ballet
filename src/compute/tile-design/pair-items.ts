import { validateTileDesign } from '../design-validation/validate.ts';
import type { TileDesignCandidate, TileValidationResult } from '../design-validation/types.ts';
import { solidAccessOptions, type SolidAccessOption } from './access.ts';
import { requiredUnits } from './capacity.ts';
import { positionKey } from './orientation.ts';
import type { ItemFlow, TileDesignInput } from './types.ts';

/** Add straight item tracks to a routed fluid pair. A track serves both copies with one
 * inserter per copy; validation checks their shared lane and each inserter's rate. */
export function addPairItems(
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
  const lanes = demands.map(({ flow, side }) => {
    const needed = requiredUnits(
      flow.rate * 2,
      input.transport.beltLaneCapacity / input.repeat.count,
    );
    if (needed > (side === 'input' ? 2 : 1)) return [];
    return side === 'output'
      ? (['left'] as const)
      : needed === 2
        ? (['left', 'right'] as const)
        : (['left'] as const);
  });
  if (lanes.some((assignment) => !assignment.length)) return;
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
      const assignedLanes =
        side === 'output' && option.face === 'east' ? (['right'] as const) : lanes[index];
      const laneResources: { left?: string; right?: string } = {};
      const laneFlows: TileDesignCandidate['boundary'][number]['laneFlows'] = {};
      for (const lane of assignedLanes) {
        laneResources[lane] = flow.resource;
        laneFlows[lane] = { side, rate: (flow.rate * 2) / assignedLanes.length };
      }
      candidate.boundary.push({
        kind: 'belt',
        x,
        direction: 'north',
        lanes: laneResources,
        laneFlows,
      });
      for (let y = 0; y < candidate.pitch; y++) {
        const entityIndex = candidate.column.entities.length;
        candidate.column.entities.push({ kind: 'belt', position: { x, y }, direction: 'north' });
        for (const lane of assignedLanes)
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
        for (const lane of assignedLanes)
          candidate.transfers.push({
            inserterIndex,
            machineId: machine.id,
            side,
            resource: flow.resource,
            beltLane: lane,
            rate: flow.rate / assignedLanes.length,
          });
      }
    }
    const validation = validateTileDesign(input, candidate);
    return validation.valid ? { candidate, validation } : undefined;
  }
  return search(0);
}
