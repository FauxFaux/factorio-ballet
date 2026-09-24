import type { DesignEntity } from '../design.ts';
import type { TileDesignCandidate, TileValidationInput } from './types.ts';

type ReportIssue = (code: string, message: string, index?: number, resource?: string) => void;

export function validateBoundary(
  input: TileValidationInput,
  candidate: TileDesignCandidate,
  lanes: Map<string, string>,
  issue: ReportIssue,
) {
  const { entities } = candidate.column;
  const trackKeys = new Set<string>();
  const declared = new Set<string>([
    ...input.boundary.inputs.items.map(({ resource }) => resource),
    ...input.boundary.outputs.items.map(({ resource }) => resource),
    ...input.boundary.inputs.fluids,
    ...input.boundary.outputs.fluids,
  ]);
  for (const track of candidate.boundary) {
    const trackKey = `${track.kind}:${track.x}`;
    if (trackKeys.has(trackKey))
      issue('boundary-duplicate', `Track ${trackKey} is declared twice.`);
    trackKeys.add(trackKey);
    if (track.kind === 'belt' && !Object.values(track.lanes ?? {}).some(Boolean))
      issue('boundary-resource', `Belt track at x=${track.x} has no lane assignment.`);
    for (const resource of track.kind === 'belt'
      ? Object.values(track.lanes ?? {})
      : [track.resource])
      if (resource && !declared.has(resource))
        issue(
          'boundary-resource',
          `Track at x=${track.x} advertises undeclared ${resource}.`,
          undefined,
          resource,
        );
    if (track.kind === 'pipe' && !track.resource)
      issue('boundary-resource', `Pipe track at x=${track.x} has no fluid assignment.`);
    const ends = [0, candidate.pitch - 1].map((y) =>
      entities.findIndex(
        (entity) =>
          entity.position.x === track.x &&
          entity.position.y === y &&
          (track.kind === 'belt'
            ? entity.kind === 'belt' || entity.kind === 'underground-belt'
            : entity.kind === 'pipe'),
      ),
    );
    if (ends.some((index) => index < 0)) {
      issue('boundary-continuity', `Track at x=${track.x} does not reach both boundaries.`);
      continue;
    }
    if (track.kind === 'belt') {
      if (
        !track.direction ||
        ends.some(
          (index) =>
            (entities[index] as Extract<DesignEntity, { kind: 'belt' }>).direction !==
            track.direction,
        ) ||
        (track.direction !== 'north' && track.direction !== 'south')
      )
        issue('boundary-direction', `Belt track at x=${track.x} has inconsistent direction.`);
      for (const [end, index] of ends.entries()) {
        const entity = entities[index];
        const isEntry = track.direction === 'north' ? end === 1 : end === 0;
        if (entity.kind === 'underground-belt' && entity.end !== (isEntry ? 'input' : 'output'))
          issue(
            'boundary-continuity',
            'Underground endpoint does not expose the tile seam.',
            index,
          );
      }
      for (const lane of ['left', 'right'] as const)
        if (
          track.lanes?.[lane] &&
          ends.some((index) => lanes.get(`${index}:${lane}`) !== track.lanes?.[lane])
        )
          issue(
            'boundary-lane',
            `Belt lane ${lane} at x=${track.x} does not match its declared resource.`,
          );
      for (let y = 0; y < candidate.pitch; y++) {
        const index = entities.findIndex(
          (entity) =>
            (entity.kind === 'belt' || entity.kind === 'underground-belt') &&
            entity.position.x === track.x &&
            entity.position.y === y,
        );
        // The belt graph proves through continuity across any hidden rows.
        if (index < 0) continue;
        for (const lane of ['left', 'right'] as const)
          if (track.lanes?.[lane] && lanes.get(`${index}:${lane}`) !== track.lanes[lane])
            issue('boundary-lane', `Belt lane ${lane} at x=${track.x} changes resource.`, index);
      }
    }
  }
  for (const side of ['inputs', 'outputs'] as const) {
    for (const flow of input.boundary[side].items)
      if (
        !candidate.boundary.some(
          (track) =>
            track.kind === 'belt' && Object.values(track.lanes ?? {}).includes(flow.resource),
        )
      )
        issue(
          'missing-boundary-item',
          `No boundary track carries ${flow.resource}.`,
          undefined,
          flow.resource,
        );
    for (const resource of input.boundary[side].fluids)
      if (!candidate.boundary.some((track) => track.kind === 'pipe' && track.resource === resource))
        issue(
          'missing-boundary-fluid',
          `No boundary pipe carries ${resource}.`,
          undefined,
          resource,
        );
  }
}
