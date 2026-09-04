import './row.css';
import { useMemo, useState } from 'preact/hooks';
import { type CellEntry, entryMachine, entryRecipe, parseCount } from '../../cell.ts';
import type { Chosen } from '../../data/index.ts';
import { machinesFor } from '../../data/machines.ts';
import { isProblem, noteText, type Solution, type SolveNote } from '../../solve/index.ts';
import { fmt } from '../../ts.ts';
import type { Recipe } from '../../types.ts';
import { recipeIconStyle } from '../icon.tsx';
import { MachinePicker } from '../machine.tsx';
import type { RowDrag } from './drag.ts';
import { ModuleBoxes } from './modules.tsx';
import { WarnIcon } from './notes.tsx';
import { RecipeConnections } from './connections.tsx';
import { recipeConnections } from './connection-calc.ts';

/**
 * One recipe of a cell: what it is, the machine chosen to run it, what is in that machine, and how
 * many of it. Everything here edits the one `CellEntry` and hands it back whole, so a control
 * added to the row needs no more plumbing than the one it sits next to.
 */
export function CellRow({
  entry,
  entryIndex,
  recipeIds,
  count,
  note,
  highlighted,
  solution,
  progress,
  chosen,
  drag,
  onChange,
  onRemove,
}: {
  entry: CellEntry;
  entryIndex: number;
  /** Recipe ids parallel to the solution's rows, used to name connected recipes. */
  recipeIds: string[];
  /** What the solver made of this row, pinned or not; `undefined` if it could not work it out. */
  count: number | undefined;
  note: SolveNote | undefined;
  highlighted: boolean;
  /** The other solved rows, used for the expanded in-cell flow breakdown. */
  solution: Solution;
  progress: number;
  /** What the header says this row has to spend: modules and a beacon; see `Chosen`. */
  chosen: Chosen;
  /** This row's part in reordering the cell; see `useRowDrag`. */
  drag: RowDrag;
  onChange: (entry: CellEntry) => void;
  onRemove: () => void;
}) {
  const recipe = entryRecipe(entry);
  const [expanded, setExpanded] = useState(false);
  const connections = useMemo(
    () => recipeConnections(entryIndex, solution, recipeIds),
    [entryIndex, recipeIds, solution],
  );
  /** The solver's complaint about this row, if it has one worth a mark on it. */
  const problem = note !== undefined && isProblem(note) ? note : undefined;
  const rowClass = [
    'cell-recipe',
    highlighted && 'is-highlighted',
    drag.dragging && 'is-dragging',
    drag.dropBefore && 'drop-before',
    drag.dropAfter && 'drop-after',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div class={rowClass} onDragOver={drag.onDragOver} onDrop={drag.onDrop}>
      <span
        class="cell-drag-handle"
        draggable
        title="Drag to reorder"
        aria-label="Reorder this recipe"
        onDragStart={(e) => {
          e.dataTransfer?.setData('text/plain', '');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          drag.onDragStart();
        }}
        onDragEnd={drag.onDragEnd}
      >
        ≡
      </span>
      <button
        type="button"
        class="cell-btn cell-row-expand"
        title={expanded ? 'Hide recipe connections' : 'Show recipe connections'}
        aria-label={expanded ? 'Hide recipe connections' : 'Show recipe connections'}
        aria-expanded={expanded}
        onClick={() => setExpanded((wasExpanded) => !wasExpanded)}
      >
        {expanded ? '▾' : '▸'}
      </button>
      <span
        class="recipe-icon"
        style={recipe ? recipeIconStyle(entry.recipe, recipe) : undefined}
        aria-hidden="true"
      />
      <span class="cell-recipe-name" title={entry.recipe}>
        {recipe?.human ?? entry.recipe}
        {recipe ? null : <span class="cell-unknown"> — not in this data</span>}
      </span>
      {/* The warning icon sits just left of the machine and keeps its place whether or not there
          is anything to say: a cell is a column of rows read as a table, and a mark which took up
          space only sometimes would shuffle every machine along as the eye went down them. */}
      <span
        class={problem ? 'cell-warn is-problem' : 'cell-warn'}
        title={problem ? noteText(problem) : undefined}
      >
        {problem ? <WarnIcon label="Not worked out" /> : null}
      </span>
      <CountBox entry={entry} count={count} onChange={onChange} />
      <div class="cell-row-controls">
        {recipe ? (
          <>
            <CellMachines entry={entry} recipe={recipe} progress={progress} onChange={onChange} />
            <ModuleBoxes
              entry={entry}
              recipe={recipe}
              machine={entryMachine(entry, recipe, progress)}
              chosen={chosen}
              onChange={onChange}
            />
          </>
        ) : null}
        <button
          type="button"
          class="cell-btn cell-remove"
          title="Remove this recipe"
          aria-label="Remove this recipe"
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {expanded ? (
        <RecipeConnections
          connections={connections}
          solved={count !== undefined}
          belt={chosen.belt}
          recipe={entry.recipe}
        />
      ) : null}
    </div>
  );
}

/**
 * Which machine runs this recipe. "Auto" is a choice of its own, not a synonym for the machine it
 * currently resolves to: it follows the progress slider, so it moves as the slider does.
 */
function CellMachines({
  entry,
  recipe,
  progress,
  onChange,
}: {
  entry: CellEntry;
  recipe: Recipe;
  progress: number;
  onChange: (entry: CellEntry) => void;
}) {
  return (
    <MachinePicker
      machines={machinesFor(recipe)}
      chosen={entryMachine(entry, recipe, progress)}
      pinned={entry.machine !== undefined}
      onChoose={(machine) => onChange({ ...entry, machine })}
    />
  );
}

/** How many machines, pinned by the user or worked out by the solver. */
function CountBox({
  entry,
  count,
  onChange,
}: {
  entry: CellEntry;
  count: number | undefined;
  onChange: (entry: CellEntry) => void;
}) {
  /* What is in the box while it is being typed in. Feeding `entry.count` straight back would round
   * trip "1." to "1" between keystrokes, so a fraction could never be typed at all; the draft is
   * dropped on blur, when the number and the text agree again. */
  const [draft, setDraft] = useState<string | undefined>(undefined);

  return (
    <input
      class={entry.count === undefined ? 'cell-count is-derived' : 'cell-count'}
      type="number"
      min={0}
      step="any"
      /* A solved count is a real value so the native number spinner starts from that number. Its
       * derived styling still distinguishes the solver's answer from a count the user pinned. */
      value={draft ?? entry.count ?? (count === undefined ? '' : fmt(count))}
      placeholder={entry.count === undefined && count === undefined ? 'auto' : ''}
      title={countTitle(entry, count)}
      aria-label="Machine count"
      onInput={(e) => {
        const raw = (e.target as HTMLInputElement).value;
        setDraft(raw);
        onChange({ ...entry, count: parseCount(raw) });
      }}
      onBlur={() => setDraft(undefined)}
    />
  );
}

/** What the count box says it is: the user's number, the solver's, or neither yet. */
function countTitle(entry: CellEntry, count: number | undefined): string {
  if (entry.count !== undefined) return 'How many machines; clear the box to have it worked out';
  if (count !== undefined) return 'Worked out from the rest of the cell; type a number to pin it';
  return 'How many machines; blank leaves it to be worked out';
}
