import './cell-row.css';
import { useState } from 'preact/hooks';
import { entryMachine, entryRecipe, parseCount, type CellEntry } from '../cell.ts';
import { machinesFor } from '../data.ts';
import { isProblem, noteText, type SolveNote } from '../solve.ts';
import { fmt } from '../ts.ts';
import type { Recipe } from '../types.ts';
import { recipeIconStyle } from './icon.tsx';
import { MachinePicker } from './machine.tsx';

/**
 * One recipe of a cell: what it is, the machine chosen to run it, what is in that machine, and how
 * many of it. Everything here edits the one `CellEntry` and hands it back whole, so a control
 * added to the row needs no more plumbing than the one it sits next to.
 */
export function CellRow({
  entry,
  count,
  note,
  progress,
  onChange,
  onRemove,
}: {
  entry: CellEntry;
  /** What the solver made of this row, pinned or not; `undefined` if it could not work it out. */
  count: number | undefined;
  note: SolveNote | undefined;
  progress: number;
  onChange: (entry: CellEntry) => void;
  onRemove: () => void;
}) {
  const recipe = entryRecipe(entry);

  return (
    <div class="cell-recipe">
      <span
        class="recipe-icon"
        style={recipe ? recipeIconStyle(entry.recipe, recipe) : undefined}
        aria-hidden="true"
      />
      <span class="cell-recipe-name" title={entry.recipe}>
        {recipe?.human ?? entry.recipe}
        {recipe ? null : <span class="cell-unknown"> — not in this data</span>}
      </span>
      {recipe ? (
        <CellMachines entry={entry} recipe={recipe} progress={progress} onChange={onChange} />
      ) : null}
      {note && isProblem(note) ? (
        <span class="cell-warn" title={noteText(note)} role="img" aria-label="Not worked out">
          ⚠
        </span>
      ) : null}
      <CountBox entry={entry} count={count} onChange={onChange} />
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
      value={draft ?? entry.count ?? ''}
      /* A worked-out count sits in the placeholder rather than the value: it is the solver's
       * answer, not the user's, and typing over it is how you disagree with it. */
      placeholder={entry.count === undefined && count !== undefined ? fmt(count) : 'auto'}
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
