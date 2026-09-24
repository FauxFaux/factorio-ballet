import type { DesignEntity } from '../design.ts';

export type EntityPositionStatus = 'valid' | 'overlap' | 'disconnected';

/** Pure occupied-tile check used by previews and candidate validation. */
export function entityPositionStatuses(entities: DesignEntity[]): EntityPositionStatus[] {
  const statuses: EntityPositionStatus[] = Array(entities.length).fill('valid');
  const bounds = entities.map((entity) => ({
    ...entity.position,
    ...(entity.kind === 'assembler' ? entity.size : { width: 1, height: 1 }),
  }));
  for (let first = 0; first < bounds.length; first++) {
    for (let second = first + 1; second < bounds.length; second++) {
      const a = bounds[first];
      const b = bounds[second];
      if (
        a.x >= b.x + b.width ||
        a.x + a.width <= b.x ||
        a.y >= b.y + b.height ||
        a.y + a.height <= b.y
      )
        continue;
      statuses[first] = 'overlap';
      statuses[second] = 'overlap';
    }
  }
  return statuses;
}
