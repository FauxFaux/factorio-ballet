import './side.css';
import type { Solution } from '../../solve/index.ts';
import type { ResourceId } from '../../types.ts';
import { ResourceButton } from '../resource.tsx';
import { PackageDependenciesIcon, PackageDependentsIcon } from '@primer/octicons-react';

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
  onSelect,
  exports = [],
  imports = [],
}: {
  dir: 'in' | 'out';
  ids: ResourceId[];
  solution: Solution;
  onSearch: (search: string) => void;
  onSelect: (id: ResourceId) => void;
  exports?: ResourceId[];
  imports?: ResourceId[];
}) {
  const side = SIDES[dir];
  const forced = dir === 'in' ? imports : exports;
  const rates = ids.map((id) =>
    dir === 'in' ? -(solution.balance.get(id) ?? 0) : (solution.balance.get(id) ?? 0),
  );
  const rateDigits = rates.some((rate) => rate > 100) ? 0 : 1;
  const pickResource = (id: ResourceId) => {
    onSelect(id);
    onSearch(side.search(id));
    document
      .getElementById('recipe-search')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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
        ids.map((id, index) => (
          <div key={id} class={forced.includes(id) ? 'cell-flow is-forced' : 'cell-flow'}>
            <ResourceButton id={id} onPick={() => pickResource(id)} />
            <span
              class="cell-forced"
              title={
                forced.includes(id)
                  ? dir === 'in'
                    ? 'Explicit import: shortfall is supplied externally'
                    : 'Explicit export: surplus is allowed to leave this cell'
                  : undefined
              }
            >
              {forced.includes(id) ? (
                dir === 'in' ? (
                  <PackageDependenciesIcon size={32} />
                ) : (
                  <PackageDependentsIcon size={32} />
                )
              ) : null}
            </span>
            <EdgeRate
              /* an input is consumed and so negative; both sides read as a rate, not a sign */
              rate={rates[index]}
              digits={rateDigits}
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
function EdgeRate({ rate, digits, partial }: { rate: number; digits: number; partial: boolean }) {
  if (!(rate > 0)) return null;
  return (
    <span
      class={partial ? 'cell-rate is-partial' : 'cell-rate'}
      title={partial ? 'So far: some rows of this cell are not worked out' : undefined}
    >
      {rate.toFixed(digits)}
      <span class="cell-rate-unit">/s</span>
    </span>
  );
}
