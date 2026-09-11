import './side.css';
import { staticData } from '../../data/decode.ts';
import type { Solution } from '../../solve/index.ts';
import type { Belt, ResourceId } from '../../types.ts';
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

/** A two-wagon fluid train carries 100k; this matches the station model's stack equivalent. */
const FLUID_TRAIN_STACK_SIZE = 1250;

/**
 * One edge of the cell. Clicking a resource searches for the recipes on the other end of it — the
 * producers of an input, the consumers of an output — and the heading's button does the same for
 * the whole side at once, which is the search you want while closing a cell up.
 */
export function CellSide({
  dir,
  ids,
  solution,
  belt,
  onSearch,
  onSelect,
  exports = [],
  imports = [],
}: {
  dir: 'in' | 'out';
  ids: ResourceId[];
  solution: Solution;
  /** The belt selected in the header, used to flag impractical station throughput. */
  belt: Belt;
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
              belt={belt}
              isFluid={id.startsWith('fluid:')}
              stackSize={
                id.startsWith('fluid:')
                  ? FLUID_TRAIN_STACK_SIZE
                  : staticData.resources[id]?.stackSize
              }
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
function EdgeRate({
  rate,
  digits,
  partial,
  belt,
  isFluid,
  stackSize,
}: {
  rate: number;
  digits: number;
  partial: boolean;
  belt: Belt;
  isFluid: boolean;
  stackSize?: number;
}) {
  if (!(rate > 0)) return null;
  const trainLimit = stackSize === undefined ? undefined : 5 * stackSize;
  const beltLimit = isFluid ? undefined : 4 * belt.itemsPerSecond;
  const warning =
    trainLimit !== undefined && rate > trainLimit
      ? {
          className: ' is-over-train-capacity',
          title:
            `Over ${trainLimit}/s (five stacks):` +
            ` four two-wagon trains per minute cannot keep one station supplied`,
        }
      : beltLimit !== undefined && rate > beltLimit
        ? {
            className: ' is-over-belt-capacity',
            title:
              `Over ${beltLimit}/s (four ${(belt.human ?? belt.item ?? 'selected belt').toLowerCase()}s):` +
              ` this would be hard to belt through one standard station`,
          }
        : undefined;
  return (
    <span
      class={`cell-rate${partial ? ' is-partial' : ''}${warning?.className ?? ''}`}
      title={
        warning?.title ??
        (partial ? 'So far: some rows of this cell are not worked out' : undefined)
      }
    >
      {rate.toFixed(digits)}
      <span class="cell-rate-unit">/s</span>
    </span>
  );
}
