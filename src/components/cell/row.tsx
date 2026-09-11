import './row.css';
import { useMemo, useState } from 'preact/hooks';
import { type CellEntry, entryMachine, entryRecipe, parseCount } from '../../cell.ts';
import type { Chosen } from '../../data/index.ts';
import { machinesFor } from '../../data/machines.ts';
import { isProblem, noteText, type Solution, type SolveNote } from '../../solve/index.ts';
import { fmt } from '../../ts.ts';
import type { Recipe, ResourceId } from '../../types.ts';
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
  expanded,
  vertical,
  solution,
  progress,
  chosen,
  drag,
  onChange,
  onRemove,
  onSelectResource,
  onToggleExpand,
}: {
  entry: CellEntry;
  entryIndex: number;
  /** Recipe ids parallel to the solution's rows, used to name connected recipes. */
  recipeIds: string[];
  /** What the solver made of this row, pinned or not; `undefined` if it could not work it out. */
  count: number | undefined;
  note: SolveNote | undefined;
  highlighted: boolean;
  expanded: boolean;
  vertical: boolean;
  /** The other solved rows, used for the expanded in-cell flow breakdown. */
  solution: Solution;
  progress: number;
  /** What the header says this row has to spend: modules and a beacon; see `Chosen`. */
  chosen: Chosen;
  /** This row's part in reordering the cell; see `useRowDrag`. */
  drag: RowDrag;
  onChange: (entry: CellEntry) => void;
  onRemove: () => void;
  onSelectResource: (resource: ResourceId) => void;
  onToggleExpand: () => void;
}) {
  const recipe = entryRecipe(entry);
  const connections = useMemo(
    () => recipeConnections(entryIndex, solution, recipeIds),
    [entryIndex, recipeIds, solution],
  );
  /** The solver's complaint about this row, if it has one worth a mark on it. */
  const problem = note !== undefined && isProblem(note) ? note : undefined;
  const expandLabel = vertical
    ? `${expanded ? 'Hide' : 'Show'} recipe connections`
    : `${expanded ? 'Hide' : 'Show'} details for ${recipe?.human ?? entry.recipe}`;
  const rowClass = [
    'cell-recipe',
    !vertical && 'is-compact',
    expanded && 'is-expanded',
    highlighted && 'is-highlighted',
    drag.dragging && 'is-dragging',
    drag.dropEdge === 'before' && 'drop-before',
    drag.dropEdge === 'after' && 'drop-after',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div class={rowClass} onDragOver={drag.onDragOver} onDrop={drag.onDrop}>
      {vertical ? <DragHandle drag={drag} /> : null}
      <button
        type="button"
        class="cell-btn cell-row-expand"
        title={expandLabel}
        aria-label={expandLabel}
        aria-expanded={expanded}
        onClick={onToggleExpand}
      >
        {expanded ? '▾' : '▸'}
      </button>
      <span
        class="recipe-icon"
        style={recipe ? recipeIconStyle(entry.recipe, recipe) : undefined}
        title={!vertical ? (recipe?.human ?? entry.recipe) : undefined}
        aria-hidden="true"
      />
      {vertical ? <RecipeName entry={entry} recipe={recipe} /> : null}
      {/* The warning icon sits just left of the machine and keeps its place whether or not there
          is anything to say: a cell is a column of rows read as a table, and a mark which took up
          space only sometimes would shuffle every machine along as the eye went down them. */}
      <RecipeWarning problem={problem} />
      <CountBox entry={entry} count={count} onChange={onChange} />
      {vertical ? (
        <RecipeControls
          entry={entry}
          recipe={recipe}
          progress={progress}
          chosen={chosen}
          onChange={onChange}
          onRemove={onRemove}
        />
      ) : null}
      {expanded && !vertical ? (
        <div class="cell-compact-recipe-details">
          <div class="cell-compact-recipe-head">
            <DragHandle drag={drag} />
            <RecipeName entry={entry} recipe={recipe} />
            <RecipeControls
              entry={entry}
              recipe={recipe}
              progress={progress}
              chosen={chosen}
              onChange={onChange}
              onRemove={onRemove}
            />
          </div>
          <RecipeConnections
            connections={connections}
            solved={count !== undefined}
            belt={chosen.belt}
            recipe={entry.recipe}
            onSelectResource={onSelectResource}
          />
        </div>
      ) : expanded ? (
        <RecipeConnections
          connections={connections}
          solved={count !== undefined}
          belt={chosen.belt}
          recipe={entry.recipe}
          onSelectResource={onSelectResource}
        />
      ) : null}
    </div>
  );
}

function DragHandle({ drag }: { drag: RowDrag }) {
  return (
    <span
      class="cell-drag-handle"
      draggable
      title="Drag to reorder"
      aria-label="Reorder this recipe"
      onDragStart={(event) => {
        event.dataTransfer?.setData('text/plain', '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        drag.onDragStart();
      }}
      onDragEnd={drag.onDragEnd}
    >
      ≡
    </span>
  );
}

function RecipeName({ entry, recipe }: { entry: CellEntry; recipe: Recipe | undefined }) {
  return (
    <span class="cell-recipe-name" title={entry.recipe}>
      {recipe?.human ?? entry.recipe}
      {recipe ? null : <span class="cell-unknown"> — not in this data</span>}
    </span>
  );
}

function RecipeWarning({ problem }: { problem: SolveNote | undefined }) {
  return (
    <span
      class={problem ? 'cell-warn is-problem' : 'cell-warn'}
      title={problem ? noteText(problem) : undefined}
    >
      {problem ? <WarnIcon label="Not worked out" /> : null}
    </span>
  );
}

function RecipeControls({
  entry,
  recipe,
  progress,
  chosen,
  onChange,
  onRemove,
}: {
  entry: CellEntry;
  recipe: Recipe | undefined;
  progress: number;
  chosen: Chosen;
  onChange: (entry: CellEntry) => void;
  onRemove: () => void;
}) {
  return (
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
