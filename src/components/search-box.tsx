import type { State } from '../ts.ts';

/** A text search input with a clear ("×") button that appears once there's something to clear. */
export function SearchBox({
  search: [search, setSearch],
  placeholder,
}: {
  search: State<string>;
  placeholder: string;
}) {
  return (
    <p class="search-box">
      <input
        type="search"
        value={search}
        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        placeholder={placeholder}
      />
      {search ? (
        <button
          type="button"
          class="search-clear"
          aria-label="Clear search"
          onClick={() => setSearch('')}
        >
          ×
        </button>
      ) : null}
    </p>
  );
}
