import { useMemo } from 'preact/hooks';
import { resourceName, staticData } from '../data.ts';
import type { State } from '../ts.ts';
import type { ResourceId } from '../types.ts';
import { ResourceButton } from './resource.tsx';

function smatch(haystack: string, search: string): boolean {
  return haystack.toLowerCase().includes(search.toLowerCase());
}

const LIMIT = 200;

/** A searchable list of every known resource (item or fluid). */
export function ResourceList({
  search: [search, setSearch],
  onPick,
}: {
  search: State<string>;
  onPick: (id: ResourceId) => void;
}) {
  const all = useMemo(
    () =>
      (Object.keys(staticData.resources) as ResourceId[])
        .map((id) => ({ id, name: resourceName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const found = useMemo(
    () => (search ? all.filter(({ id, name }) => smatch(name, search) || smatch(id, search)) : all),
    [all, search],
  );

  return (
    <div class="resource-list">
      <p>
        <input
          type="text"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="Search items and fluids..."
        />
      </p>
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
