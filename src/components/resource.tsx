import { resourceName } from '../data.ts';
import type { ResourceId } from '../types.ts';

/**
 * A resource shown with its icon. The icon is a placeholder for now; we'll
 * wire up the real sprites later.
 */
export function ResourceWithIcon({ id }: { id: ResourceId }) {
  const [kind] = id.split(':', 1);
  const name = resourceName(id);
  return (
    <span class="resource" title={id}>
      <span class={`resource-icon resource-icon-${kind}`} aria-hidden="true" />
      {name}
    </span>
  );
}
