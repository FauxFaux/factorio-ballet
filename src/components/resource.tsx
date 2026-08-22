import { staticData } from '../data.ts';
import type { ResourceId } from '../types.ts';
import { iconStyle } from './icon.tsx';

export function ResourceWithIcon({ id }: { id: ResourceId }) {
  const resource = staticData.resources[id];
  return (
    <span class="resource" title={`${id} (${resource.stackSize ?? 'fluid'})`}>
      <span class="resource-icon" style={iconPos(id)} aria-hidden="true" />
      {resource.human ?? <span class="resource-is-id">{id}</span>}
    </span>
  );
}

/** A resource which, when clicked, searches for the recipes making it. */
export function ResourceButton({
  id,
  onPick,
}: {
  id: ResourceId;
  onPick: (id: ResourceId) => void;
}) {
  return (
    <button type="button" class="resource-button" onClick={() => onPick(id)}>
      <ResourceWithIcon id={id} />
    </button>
  );
}

function iconPos(id: ResourceId): string {
  const colon = id.indexOf(':');
  const kind = id.slice(0, colon);
  const name = id.slice(colon + 1);
  return iconStyle(
    `craft:${name}`,
    kind === 'fluid' ? 'craft:fluid-unknown' : 'craft:item-unknown',
  );
}
