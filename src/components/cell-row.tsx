import './cell-row.css';
import { useState } from 'preact/hooks';
import {
  entryMachine,
  entryRecipe,
  entryRun,
  parseCount,
  parseModules,
  type CellEntry,
} from '../cell.ts';
import { machinesFor, rowBeacon } from '../data.ts';
import type { Boost, Effects } from '../flow.ts';
import { isProblem, noteText, type SolveNote } from '../solve.ts';
import { fmt } from '../ts.ts';
import type { MachineId, ModuleId, Recipe } from '../types.ts';
import { recipeIconStyle, resourceIconStyle } from './icon.tsx';
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
  speedModule,
  onChange,
  onRemove,
}: {
  entry: CellEntry;
  /** What the solver made of this row, pinned or not; `undefined` if it could not work it out. */
  count: number | undefined;
  note: SolveNote | undefined;
  progress: number;
  /** Which module the header means by "a speed module"; see `CellEntry.speedModules`. */
  speedModule?: ModuleId;
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
        <>
          <CellMachines entry={entry} recipe={recipe} progress={progress} onChange={onChange} />
          <SpeedBox
            entry={entry}
            recipe={recipe}
            machine={entryMachine(entry, recipe, progress)}
            speedModule={speedModule}
            onChange={onChange}
          />
        </>
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

/**
 * How many speed modules this row is to feel — the machine's own slots first, and beacons for
 * whatever is left over, which is why one number can ask for more than the machine holds. Blank is
 * auto: fill the slots, build no beacons, and the placeholder says how many that is.
 *
 * Which module those are is the header's business and not the row's, so this box is a count and
 * never a picker; with no speed module chosen — the whole early game — the count buys nothing, and
 * the tooltip says so rather than the box disappearing under the user.
 */
function SpeedBox({
  entry,
  recipe,
  machine,
  speedModule,
  onChange,
}: {
  entry: CellEntry;
  recipe: Recipe;
  machine: MachineId | undefined;
  speedModule?: ModuleId;
  onChange: (entry: CellEntry) => void;
}) {
  /* As `CountBox`'s: the box holds what is being typed, so a half-typed number is not rounded out
     from under the caret. */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const { effects, boost } = entryRun(entry, recipe, machine, speedModule);
  const auto = entry.speedModules === undefined;

  return (
    <span class="cell-speed" title={speedTitle(boost, effects)}>
      <span
        class="cell-speed-icon"
        style={boost.module ? resourceIconStyle(`item:${boost.module}`) : undefined}
        aria-hidden="true"
      />
      <input
        class={auto ? 'cell-speed-count is-derived' : 'cell-speed-count'}
        type="number"
        min={0}
        step={1}
        value={draft ?? entry.speedModules ?? ''}
        /* What "auto" comes to, in the placeholder for the same reason the solver's count is:
           it is what would happen, not what was asked for. */
        placeholder={auto ? fmt(boost.wanted) : ''}
        aria-label="Speed modules"
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          setDraft(raw);
          onChange({ ...entry, speedModules: parseModules(raw) });
        }}
        onBlur={() => setDraft(undefined)}
      />
      {boost.beacons > 0 ? (
        <span class="cell-beacons">
          <span
            class="cell-speed-icon"
            style={rowBeacon?.item ? resourceIconStyle(`item:${rowBeacon.item}`) : undefined}
            aria-hidden="true"
          />
          ×{boost.beacons}
        </span>
      ) : null}
    </span>
  );
}

/** The whole of what the speed box did, as a sentence: where the modules went and what came of it. */
function speedTitle(boost: Boost, effects: Effects): string {
  if (!boost.module) {
    return 'Speed modules for this row. None is chosen in the header, so nothing here is modded yet.';
  }
  const beacons =
    boost.beacons === 0
      ? 'no beacons'
      : `${fmt(boost.inBeacons)} over ${boost.beacons} ${boost.beacons === 1 ? 'beacon' : 'beacons'}` +
        ` at ${fmt(boost.transmission * 100)}% each`;
  const lost = boost.wanted - boost.inMachine - boost.inBeacons;
  const nowhere = lost > 0 ? `, ${fmt(lost)} with nowhere to go` : '';
  return (
    `${fmt(boost.wanted)} speed modules: ${fmt(boost.inMachine)} in the machine, ${beacons}${nowhere}` +
    ` — ×${fmt(effects.speed)} speed. Blank fills the machine and builds no beacons.`
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
