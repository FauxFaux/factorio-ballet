import './side.css';
import { fmt } from '../../ts.ts';
import type { Solution } from '../../solve.ts';
import type { ResourceId } from '../../types.ts';
import { ResourceButton } from '../resource.tsx';

/** The label, tooltip and search each side of a cell gets; the two sides are mirror images. */
const SIDES = {
  in: {
    label: 'in',
    hint: 'Fed to this cell: used by a recipe here, made by none',
    scope: 'makes:@in',
    scopeHint: 'Search for recipes making anything this cell needs',
    search: (id: ResourceId) => `makes:${id}`,
  },
  out: {
    label: 'out',
    hint: 'Handed on by this cell: made by a recipe here, used by none',
    scope: 'uses:@out',
    scopeHint: 'Search for recipes using anything this cell produces',
    search: (id: ResourceId) => `uses:${id}`,
  },
} as const;

/**
 * One edge of the cell. Clicking a resource searches for the recipes on the other end of it — the
 * producers of an input, the consumers of an output — and the heading's button does the same for
 * the whole side at once, which is the search you want while closing a cell up.
 */
export function CellSide({
  dir,
  ids,
  solution,
  onSearch,
}: {
  dir: 'in' | 'out';
  ids: ResourceId[];
  solution: Solution;
  onSearch: (search: string) => void;
}) {
  const side = SIDES[dir];
  return (
    <div class={`cell-side cell-${dir}`}>
      <h3 class="cell-side-head" title={side.hint}>
        {side.label}
        {ids.length ? (
          <button
            type="button"
            class="cell-btn"
            title={`${side.scopeHint} (${side.scope})`}
            aria-label={side.scopeHint}
            onClick={() => onSearch(side.scope)}
          >
            ⌕
          </button>
        ) : null}
      </h3>
      {ids.length === 0 ? (
        <p class="cell-none">—</p>
      ) : (
        ids.map((id) => (
          <div key={id} class="cell-flow">
            <ResourceButton id={id} onPick={() => onSearch(side.search(id))} />
            <EdgeRate
              /* an input is consumed and so negative; both sides read as a rate, not a sign */
              rate={
                dir === 'in' ? -(solution.balance.get(id) ?? 0) : (solution.balance.get(id) ?? 0)
              }
              partial={!solution.complete}
            />
          </div>
        ))
      )}
    </div>
  );
}

/**
 * A rate on one side of the cell. Nothing at all where the solver did not get that far: a zero
 * would read as "none of this crosses the edge", which is a different claim from "not worked out".
 */
function EdgeRate({ rate, partial }: { rate: number; partial: boolean }) {
  if (!(rate > 0)) return null;
  return (
    <span
      class={partial ? 'cell-rate is-partial' : 'cell-rate'}
      title={partial ? 'So far: some rows of this cell are not worked out' : undefined}
    >
      {fmt(rate)}
      <span class="cell-rate-unit">/s</span>
    </span>
  );
}
