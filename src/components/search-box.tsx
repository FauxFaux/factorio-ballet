import './search-box.css';
import type { ComponentChildren } from 'preact';
import type { State } from '../ts.ts';

/**
 * A text search input with a clear ("×") button that appears once there's something to
 * clear. `children` are extra `.search-btn` buttons, shown left of the clear button.
 */
export function SearchBox({
  search: [search, setSearch],
  id,
  placeholder,
  children,
}: {
  search: State<string>;
  /** An optional document target for controls elsewhere that reveal this search. */
  id?: string;
  placeholder: string;
  children?: ComponentChildren;
}) {
  return (
    <p class="search-box">
      <input
        id={id}
        type="search"
        value={search}
        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        placeholder={placeholder}
      />
      <span class="search-buttons">
        {children}
        {search ? (
          <button
            type="button"
            class="search-btn"
            aria-label="Clear search"
            onClick={() => setSearch('')}
          >
            ×
          </button>
        ) : null}
      </span>
    </p>
  );
}
