import './cell.css';
import { useMemo, useState } from 'preact/hooks';
import {
  activeAfterRemoval,
  cellInterface,
  cellTitle,
  entryMachine,
  entryRecipe,
  newCell,
  parseCount,
  withEntry,
  withoutCell,
  withoutEntry,
  type Cell,
  type CellEntry,
} from '../cell.ts';
import { machinesFor, resourceName } from '../data.ts';
import {
  isProblem,
  noteFor,
  noteLine,
  noteText,
  solveCell,
  type Solution,
  type SolveNote,
} from '../solve.ts';
import { atIndex, fmt, type State } from '../ts.ts';
import type { Recipe, ResourceId } from '../types.ts';
import { recipeIconStyle } from './icon.tsx';
import { MachinePicker } from './machine.tsx';
import { ResourceButton, ResourceIcon } from './resource.tsx';

/**
 * The cells being planned, and the controls for which one is being worked on. Adding a recipe from
 * the search goes to that one, so the whole list is really one editor plus its neighbours.
 */
export function CellList({
  cells,
  active,
  progress,
  setSearch,
}: {
  cells: State<Cell[]>;
  active: State<number>;
  /** Where the player is through the game, which decides the machine a recipe defaults to. */
  progress: number;
  setSearch: (search: string) => void;
}) {
  const [list, setList] = cells;
  const [current, setCurrent] = active;

  const add = () => {
    setList((prev) => [...prev, newCell()]);
    setCurrent(list.length);
  };

  /* The index of the cell being worked on has to survive the removal of another; see
   * {@link activeAfterRemoval}. */
  const remove = (index: number) => {
    const left = list.length - 1;
    setList((prev) => withoutCell(prev, index));
    setCurrent((prev) => activeAfterRemoval(prev, index, left));
  };

  return (
    <section class="cells">
      <header class="cells-head">
        <h2>Cells</h2>
        <button type="button" class="cell-btn" title="Start an empty cell" onClick={add}>
          + cell
        </button>
      </header>
      {list.length === 0 ? (
        <p class="recipe-hint">
          No cells yet: add a recipe from the search with <code>+</code> to start one.
        </p>
      ) : null}
      {list.map((_, i) => (
        <CellBox
          key={i}
          cell={atIndex(cells, i)}
          active={i === current}
          progress={progress}
          onActivate={() => setCurrent(i)}
          onRemove={() => remove(i)}
          /* Searching from a cell means working on it: the `@in`/`@out` queries read the cell being
           * worked on, so a search launched from another one would answer about the wrong cell. */
          onSearch={(search) => {
            setCurrent(i);
            setSearch(search);
          }}
        />
      ))}
    </section>
  );
}

/**
 * One cell: what it must be fed on the left, what it hands on on the right, and the recipes and
 * machines doing the work between them — a sankey diagram's shape, without the sankey.
 *
 * The solver runs on every keystroke, which it can afford to: a cell is a handful of rows. Its
 * answer is a display layer over the cell and never written back, exactly as the default machine
 * is — a count is the user's only when they typed it.
 */
function CellBox({
  cell: [cell, setCell],
  active,
  progress,
  onActivate,
  onRemove,
  onSearch,
}: {
  cell: State<Cell>;
  active: boolean;
  progress: number;
  onActivate: () => void;
  onRemove: () => void;
  onSearch: (search: string) => void;
}) {
  const iface = useMemo(() => cellInterface(cell), [cell]);
  const solution = useMemo(() => solveCell(cell, progress), [cell, progress]);

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

/** One recipe of a cell, the machine chosen to run it, and how many of that machine. */
function CellRow({
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
  /* What is in the box while it is being typed in. Feeding `entry.count` straight back would round
   * trip "1." to "1" between keystrokes, so a fraction could never be typed at all; the draft is
   * dropped on blur, when the number and the text agree again. */
  const [draft, setDraft] = useState<string | undefined>(undefined);

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

/** What the count box says it is: the user's number, the solver's, or neither yet. */
function countTitle(entry: CellEntry, count: number | undefined): string {
  if (entry.count !== undefined) return 'How many machines; clear the box to have it worked out';
  if (count !== undefined) return 'Worked out from the rest of the cell; type a number to pin it';
  return 'How many machines; blank leaves it to be worked out';
}
