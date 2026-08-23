import './cell.css';
import { useMemo } from 'preact/hooks';
import { cellInterface, cellTitle, withEntry, withoutEntry, type Cell } from '../cell.ts';
import { resourceName } from '../data.ts';
import { isProblem, noteFor, noteLine, solveCell, type Solution } from '../solve.ts';
import { fmt, type State } from '../ts.ts';
import type { ModuleId, ResourceId } from '../types.ts';
import { CellRow } from './cell-row.tsx';
import { ResourceButton, ResourceIcon } from './resource.tsx';

/**
 * One cell: what it must be fed on the left, what it hands on on the right, and the recipes and
 * machines doing the work between them — a sankey diagram's shape, without the sankey.
 *
 * The solver runs on every keystroke, which it can afford to: a cell is a handful of rows. Its
 * answer is a display layer over the cell and never written back, exactly as the default machine
 * is — a count is the user's only when they typed it.
 */
export function CellBox({
  cell: [cell, setCell],
  active,
  progress,
  speedModule,
  onActivate,
  onRemove,
  onSearch,
}: {
  cell: State<Cell>;
  active: boolean;
  progress: number;
  /** Which module the header means by "a speed module"; see `CellEntry.speedModules`. */
  speedModule?: ModuleId;
  onActivate: () => void;
  onRemove: () => void;
  onSearch: (search: string) => void;
}) {
  const iface = useMemo(() => cellInterface(cell), [cell]);
  const solution = useMemo(
    () => solveCell(cell, progress, speedModule),
    [cell, progress, speedModule],
  );

  return (
    <section class={active ? 'cell is-active' : 'cell'}>
      <header class="cell-head">
        <button
          type="button"
          class="cell-title"
          aria-pressed={active}
          title={active ? 'The cell being worked on' : 'Work on this cell'}
          onClick={onActivate}
        >
          {cellTitle(cell)}
        </button>
        <span class="cell-size">
          {cell.entries.length} {cell.entries.length === 1 ? 'recipe' : 'recipes'}
        </span>
        <button
          type="button"
          class="cell-btn cell-remove"
          title="Remove this cell"
          aria-label="Remove this cell"
          onClick={onRemove}
        >
          ×
        </button>
      </header>
      <div class="cell-body">
        <CellSide dir="in" ids={iface.inputs} solution={solution} onSearch={onSearch} />
        <div class="cell-middle">
          {cell.entries.length === 0 ? (
            <p class="recipe-hint">Add a recipe from the search.</p>
          ) : (
            cell.entries.map((entry, i) => (
              <CellRow
                key={entry.recipe}
                entry={entry}
                count={solution.counts[i]}
                note={noteFor(solution, i)}
                progress={progress}
                speedModule={speedModule}
                onChange={(next) => setCell((prev) => withEntry(prev, i, next))}
                onRemove={() => setCell((prev) => withoutEntry(prev, i))}
              />
            ))
          )}
          {iface.internal.length ? <InternalRow ids={iface.internal} solution={solution} /> : null}
          <SolveNotes cell={cell} solution={solution} />
        </div>
        <CellSide dir="out" ids={iface.outputs} solution={solution} onSearch={onSearch} />
      </div>
    </section>
  );
}

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
function CellSide({
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

/**
 * What the cell makes and consumes itself. `cellInterface` calls a resource internal on set
 * arithmetic alone, so one of these balancing at zero is the cell handling it — and one which does
 * not is a leftover the user is about to have to do something about, which is why it is spelled out
 * here rather than left to the icon.
 */
function InternalRow({ ids, solution }: { ids: ResourceId[]; solution: Solution }) {
  return (
    <p class="cell-internal" title="Made and used inside this cell">
      internal
      {ids.map((id) => {
        const rate = solution.balance.get(id) ?? 0;
        return (
          <span
            key={id}
            class="cell-internal-chip"
            title={
              rate === 0
                ? `${resourceName(id)}: balanced`
                : `${resourceName(id)}: ${rate > 0 ? 'spare' : 'short'} ${fmt(Math.abs(rate))}/s`
            }
          >
            <ResourceIcon id={id} />
            {rate === 0 ? null : (
              <span class="cell-leftover">
                {rate > 0 ? '+' : '−'}
                {fmt(Math.abs(rate))}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

/**
 * Everything the solver assumed or could not do, in one place under the rows it happened to. The
 * ⚠ on a row points at the same sentence; this is the version you can read without hovering.
 */
function SolveNotes({ cell, solution }: { cell: Cell; solution: Solution }) {
  if (solution.notes.length === 0) return null;
  return (
    <ul class="cell-notes">
      {solution.notes.map((note) => (
        <li
          key={`${note.entry}:${note.kind}`}
          class={isProblem(note) ? 'cell-note is-problem' : 'cell-note'}
        >
          {noteLine(cell, note)}
        </li>
      ))}
    </ul>
  );
}
