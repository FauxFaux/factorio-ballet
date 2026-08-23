import './cell.css';
import { useMemo, useState } from 'preact/hooks';
import {
  cellInterface,
  cellTitle,
  entryMachine,
  entryRecipe,
  newCell,
  withEntry,
  withoutEntry,
  type Cell,
  type CellEntry,
} from '../cell.ts';
import { machinesFor, resourceName } from '../data.ts';
import { atIndex, type State } from '../ts.ts';
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

  /* The index of the cell being worked on has to survive the removal of another: it shifts down
   * with the list, and clamps into what is left when the last cell goes. */
  const remove = (index: number) => {
    const left = list.length - 1;
    setList((prev) => prev.filter((_, i) => i !== index));
    setCurrent((prev) => Math.min(prev > index ? prev - 1 : prev, Math.max(0, left - 1)));
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
 * machines doing the work between them — a sankey diagram's shape, without the sankey. Nothing here
 * is scaled yet; see `Cell`.
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
        <CellSide dir="in" ids={iface.inputs} onSearch={onSearch} />
        <div class="cell-middle">
          {cell.entries.length === 0 ? (
            <p class="recipe-hint">Add a recipe from the search.</p>
          ) : (
            cell.entries.map((entry, i) => (
              <CellRow
                key={entry.recipe}
                entry={entry}
                progress={progress}
                onChange={(next) => setCell((prev) => withEntry(prev, i, next))}
                onRemove={() => setCell((prev) => withoutEntry(prev, i))}
              />
            ))
          )}
          {iface.internal.length ? <InternalRow ids={iface.internal} /> : null}
        </div>
        <CellSide dir="out" ids={iface.outputs} onSearch={onSearch} />
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
  onSearch,
}: {
  dir: 'in' | 'out';
  ids: ResourceId[];
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
          <ResourceButton key={id} id={id} onPick={() => onSearch(side.search(id))} />
        ))
      )}
    </div>
  );
}

/** One recipe of a cell, and the machine chosen to run it. */
function CellRow({
  entry,
  progress,
  onChange,
  onRemove,
}: {
  entry: CellEntry;
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
      <input
        class="cell-count"
        type="number"
        min={0}
        step="any"
        value={draft ?? entry.count ?? ''}
        placeholder="auto"
        title="How many machines; blank leaves it to be worked out"
        aria-label="Machine count"
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          setDraft(raw);
          const count = Number(raw);
          onChange({ ...entry, count: raw && Number.isFinite(count) ? count : undefined });
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

/** What the cell makes and consumes itself: not part of its interface, but worth being able to see. */
function InternalRow({ ids }: { ids: ResourceId[] }) {
  return (
    <p class="cell-internal" title="Made and used inside this cell">
      internal
      {ids.map((id) => (
        <span key={id} class="cell-internal-chip" title={resourceName(id)}>
          <ResourceIcon id={id} />
        </span>
      ))}
    </p>
  );
}
