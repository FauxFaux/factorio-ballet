import './cell-row.css';
import { useState } from 'preact/hooks';
import {
  entryBoost,
  entryMachine,
  entryRecipe,
  entryRun,
  flipBoost,
  parseCount,
  parseModules,
  type CellEntry,
} from '../cell.ts';
import {
  BOOST_CATEGORY,
  machinesFor,
  modulesIn,
  rowBeacon,
  type BoostEffect,
  type ChosenModules,
} from '../data.ts';
import type { Boost, Effects } from '../flow.ts';
import { isProblem, noteText, type SolveNote } from '../solve.ts';
import { fmt } from '../ts.ts';
import type { MachineId, Recipe } from '../types.ts';
import { recipeIconStyle, resourceIconStyle } from './icon.tsx';
import { MachinePicker } from './machine.tsx';
import { UnlitIcon } from './module.tsx';

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
  modules,
  dragging,
  dropBefore,
  dropAfter,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onChange,
  onRemove,
}: {
  entry: CellEntry;
  /** What the solver made of this row, pinned or not; `undefined` if it could not work it out. */
  count: number | undefined;
  note: SolveNote | undefined;
  progress: number;
  /** Which module the header means by each family this row can spend; see `ChosenModules`. */
  modules: ChosenModules;
  /** Whether this is the row currently being dragged, for the fade the rest of the list gets. */
  dragging: boolean;
  /** Whether the dragged row would land just above or below this one. */
  dropBefore: boolean;
  dropAfter: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onChange: (entry: CellEntry) => void;
  onRemove: () => void;
}) {
  const recipe = entryRecipe(entry);
  const rowClass = [
    'cell-recipe',
    dragging && 'is-dragging',
    dropBefore && 'drop-before',
    dropAfter && 'drop-after',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      class={rowClass}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e);
      }}
    >
      <span
        class="cell-drag-handle"
        draggable
        title="Drag to reorder"
        aria-label="Reorder this recipe"
        onDragStart={(e) => {
          e.dataTransfer?.setData('text/plain', '');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        ≡
      </span>
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
          <BoostBox
            entry={entry}
            recipe={recipe}
            machine={entryMachine(entry, recipe, progress)}
            modules={modules}
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
 * How many modules this row is to feel — the machine's own slots first, and beacons for whatever is
 * left over, which is why one number can ask for more than the machine holds. Blank is auto: fill
 * the slots, build no beacons, and the placeholder says how many that is.
 *
 * Which family they come from is the row's own choice and the icon is the control for it: a recipe
 * which allows productivity defaults to productivity modules, because more out of the same
 * ingredients is what you would reach for there, and clicking the icon spends speed modules
 * instead. A recipe which does not allow productivity has no such choice to offer — a productivity
 * module in it is nothing but its own speed malus — so the icon is just an icon.
 *
 * Which *tier* either family means is the header's business and not the row's, so this box is a
 * count and never a picker; with no module chosen there — the whole early game — the count buys
 * nothing, and the tooltip says so rather than the box disappearing under the user.
 */
function BoostBox({
  entry,
  recipe,
  machine,
  modules,
  onChange,
}: {
  entry: CellEntry;
  recipe: Recipe;
  machine: MachineId | undefined;
  modules: ChosenModules;
  onChange: (entry: CellEntry) => void;
}) {
  /* As `CountBox`'s: the box holds what is being typed, so a half-typed number is not rounded out
     from under the caret. */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const effect = entryBoost(entry, recipe);
  const { effects, boost } = entryRun(entry, recipe, machine, modules);
  const auto = entry.boostModules === undefined;
  const family = effect === 'speed' ? 'Speed' : 'Productivity';

  /* No module chosen in the header is the early game's answer and not a missing one, so the box
     says which family it is spending and that the family is off, exactly as the picker up there
     does. */
  const icon = boost.module ? (
    <span
      class="cell-boost-icon"
      style={resourceIconStyle(`item:${boost.module}`)}
      aria-hidden="true"
    />
  ) : (
    <UnlitIcon modules={modulesIn(BOOST_CATEGORY[effect])} class="cell-boost-icon" />
  );

  return (
    <span class="cell-boost" title={boostTitle(effect, boost, effects)}>
      {recipe.allowProductivity ? (
        <button
          type="button"
          class="cell-boost-flip"
          title={
            effect === 'speed'
              ? 'Spending speed modules — click for productivity instead'
              : 'Spending productivity modules — click for speed instead'
          }
          aria-label={`Spend ${effect === 'speed' ? 'productivity' : 'speed'} modules instead`}
          onClick={() => onChange(flipBoost(entry, recipe))}
        >
          {icon}
        </button>
      ) : (
        icon
      )}
      <input
        class={auto ? 'cell-boost-count is-derived' : 'cell-boost-count'}
        type="number"
        min={0}
        step={1}
        value={draft ?? entry.boostModules ?? ''}
        /* What "auto" comes to, in the placeholder for the same reason the solver's count is:
           it is what would happen, not what was asked for. */
        placeholder={auto ? fmt(boost.wanted) : ''}
        aria-label={`${family} modules`}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          setDraft(raw);
          onChange({ ...entry, boostModules: parseModules(raw) });
        }}
        onBlur={() => setDraft(undefined)}
      />
      {boost.beacons > 0 ? (
        <span class="cell-beacons">
          <span
            class="cell-boost-icon"
            style={rowBeacon?.item ? resourceIconStyle(`item:${rowBeacon.item}`) : undefined}
            aria-hidden="true"
          />
          ×{boost.beacons}
        </span>
      ) : null}
    </span>
  );
}

/** The whole of what the boost box did, as a sentence: where the modules went and what came of it. */
function boostTitle(effect: BoostEffect, boost: Boost, effects: Effects): string {
  const family = effect === 'speed' ? 'Speed' : 'Productivity';
  if (!boost.module) {
    return `${family} modules for this row. None is chosen in the header, so nothing here is modded yet.`;
  }
  const beacons =
    boost.beacons === 0
      ? 'no beacons'
      : `${fmt(boost.inBeacons)} over ${boost.beacons} ${boost.beacons === 1 ? 'beacon' : 'beacons'}` +
        ` at ${fmt(boost.transmission * 100)}% each`;
  const lost = boost.wanted - boost.inMachine - boost.inBeacons;
  const nowhere = lost > 0 ? `, ${fmt(lost)} with nowhere to go` : '';
  /* Where the two families part company, and the reason a productivity row's overflow goes nowhere:
     no beacon transmits productivity, so the machine's own slots are the whole of it. */
  const blank =
    effect === 'speed'
      ? 'Blank fills the machine and builds no beacons.'
      : 'Blank fills the machine; productivity modules do not go in beacons.';
  return (
    `${fmt(boost.wanted)} ${family.toLowerCase()} modules: ${fmt(boost.inMachine)} in the machine,` +
    ` ${beacons}${nowhere} — ${outcome(effects)}. ${blank}`
  );
}

/**
 * What the row ends up running at: only the multiplier which is not 1, because a speed row quoting
 * "×1 output" and a productivity row quoting the speed it did not change are both noise. Nothing
 * survives when the machine applies neither, which is a real answer — a productivity module on a
 * machine which ignores productivity is a slower machine and nothing else, and that shows up here
 * as the speed it cost.
 */
function outcome(effects: Effects): string {
  const parts: string[] = [];
  if (effects.speed !== 1) parts.push(`×${fmt(effects.speed)} speed`);
  if (effects.productivity !== 1) parts.push(`×${fmt(effects.productivity)} output`);
  return parts.length ? parts.join(', ') : 'no effect in this machine';
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
