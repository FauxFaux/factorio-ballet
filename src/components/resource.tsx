import { staticData } from '../data.ts';
import type { ResourceId } from '../types.ts';
import iconsUrl from '../assets/icons.avif';
import iconsData from '../assets/icons.json';

const icons = iconsData as unknown as Record<string, [number, number]>;

export function ResourceWithIcon({ id }: { id: ResourceId }) {
  const resource = staticData.resources[id];
  return (
    <span class="resource" title={`${id} (${resource.stackSize ?? 'fluid'})`}>
      <span class="resource-icon" style={iconPos(id)} aria-hidden="true" />
      {resource.human ?? <span class="resource-is-id">{id}</span>}
    </span>
  );
}

function iconPos(id: ResourceId): string {
  const colon = id.indexOf(':');
  const kind = id.slice(0, colon);
  const name = id.slice(colon + 1);
  const pos = icons[`craft:${name}`] ??
    icons[kind === 'fluid' ? 'craft:fluid-unknown' : 'craft:item-unknown'] ?? [0, 0];
  return `background: url("${iconsUrl}") -${pos[0]}px -${pos[1]}px no-repeat`;
}
