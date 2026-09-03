import { useMemo } from 'preact/hooks';
import { relevanceOf, resourceName, staticData } from '../data/index.ts';
import type { State } from '../ts.ts';
import type { Resource, ResourceId } from '../types.ts';
import { ResourceButton } from './resource.tsx';
import { SearchBox } from './search-box.tsx';

function smatch(haystack: string, search: string): boolean {
  return haystack.toLowerCase().includes(search.toLowerCase());
}

const LIMIT = 200;

/**
 * A searchable list of every known resource (item or fluid), the ones nearest `progress` — where the
 * player is in the tech tree, 0 to 1 — first; see `relevanceOf`. At 0 that is simplest first.
 */
export function ResourceList({
  search: [search, setSearch],
  progress,
  onPick,
}: {
  search: State<string>;
  progress: number;
  onPick: (id: ResourceId) => void;
}) {
  const all = useMemo(
    () =>
      (Object.entries(staticData.resources) as [ResourceId, Resource][]).map(([id, resource]) => ({
        id,
        name: resourceName(id),
        resource,
      })),
    [],
  );

  // Sorting belongs here rather than with `all`, because the order depends on `progress`.
  const found = useMemo(
    () =>
      all
        .filter(({ id, name }) => !search || smatch(name, search) || smatch(id, search))
        .sort(
          (a, b) =>
            relevanceOf(a.resource, progress) - relevanceOf(b.resource, progress) ||
            a.name.localeCompare(b.name),
        ),
    [all, search, progress],
  );

  return (
    <div class="resource-list">
      <SearchBox search={[search, setSearch]} placeholder="Search items and fluids..." />
      <table>
        <tbody>
          {found.slice(0, LIMIT).map(({ id }) => (
            <tr key={id}>
              <td>
                <ResourceButton id={id} onPick={onPick} />
              </td>
            </tr>
          ))}
          {found.length > LIMIT ? (
            <tr>
              <td>…and {found.length - LIMIT} more</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
