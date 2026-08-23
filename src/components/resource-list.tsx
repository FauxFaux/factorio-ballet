import { useMemo } from 'preact/hooks';
import { complexityOf, resourceName, staticData } from '../data.ts';
import type { State } from '../ts.ts';
import type { Resource, ResourceId } from '../types.ts';
import { ResourceButton } from './resource.tsx';
import { SearchBox } from './search-box.tsx';

function smatch(haystack: string, search: string): boolean {
  return haystack.toLowerCase().includes(search.toLowerCase());
}

const LIMIT = 200;

/** A searchable list of every known resource (item or fluid), simplest first. */
export function ResourceList({
  search: [search, setSearch],
  onPick,
}: {
  search: State<string>;
  onPick: (id: ResourceId) => void;
}) {
  const all = useMemo(
    () =>
      (Object.entries(staticData.resources) as [ResourceId, Resource][])
        .map(([id, resource]) => ({
          id,
          name: resourceName(id),
          complexity: complexityOf(resource),
        }))
        .sort((a, b) => a.complexity - b.complexity || a.name.localeCompare(b.name)),
    [],
  );

  const found = useMemo(
    () => (search ? all.filter(({ id, name }) => smatch(name, search) || smatch(id, search)) : all),
    [all, search],
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
