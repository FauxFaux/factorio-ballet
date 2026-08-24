import './box.css';
import { useMemo } from 'preact/hooks';
import {
  cellInterface,
  cellTitle,
  moveEntry,
  withEntry,
  withoutEntry,
  type Cell,
} from '../../cell.ts';
import type { ChosenModules } from '../../data.ts';
import { noteFor, solveCell } from '../../solve.ts';
import type { State } from '../../ts.ts';
import { useRowDrag } from './drag.ts';
import { InternalRow } from './internal.tsx';
import { SolveNotes } from './notes.tsx';
import { CellRow } from './row.tsx';
import { CellSide } from './side.tsx';

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
  modules,
  onActivate,
  onRemove,
  onSearch,
}: {
  cell: State<Cell>;
  active: boolean;
  progress: number;
  /** Which module the header means by each family a row can spend; see `ChosenModules`. */
  modules: ChosenModules;
  onActivate: () => void;
  onRemove: () => void;
  onSearch: (search: string) => void;
}) {
  const iface = useMemo(() => cellInterface(cell), [cell]);
  const solution = useMemo(() => solveCell(cell, progress, modules), [cell, progress, modules]);
  const rowDrag = useRowDrag((from, to) => setCell((prev) => moveEntry(prev, from, to)));

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
                modules={modules}
                drag={rowDrag(i)}
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
