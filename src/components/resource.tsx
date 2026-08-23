import './resource.css';
import { staticData } from '../data.ts';
import type { ResourceId } from '../types.ts';
import { resourceIconStyle } from './icon.tsx';

export function ResourceWithIcon({ id }: { id: ResourceId }) {
  const resource = staticData.resources[id];
  return (
    <span class="resource" title={`${id} (${resource.stackSize ?? 'fluid'})`}>
      <ResourceIcon id={id} />
      {resource.human ?? <span class="resource-is-id">{id}</span>}
    </span>
  );
}

/** Just the sprite for a resource, for places which label it themselves. */
export function ResourceIcon({ id }: { id: ResourceId }) {
  return <span class="resource-icon" style={resourceIconStyle(id)} aria-hidden="true" />;
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
