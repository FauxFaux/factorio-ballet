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
import { categoryName, machinesFor, modulesIn, type ChosenModules } from '../data.ts';
import type { Boost, Effects, Layout } from '../flow.ts';
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
          <ModuleBoxes
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
 * What is in this row's machines: how many productivity modules, and how many speed modules. Two
 * numbers rather than one control, because the game answers them differently — productivity has
 * nowhere to be but the machine's own slots, while speed has beacons and so no ceiling — and
 * because wanting both at once is the ordinary case, not an exotic one.
 *
 * Where they all end up is worked out rather than asked for: productivity takes the slots it is
 * given, speed fills whatever is left, and the rest of the speed is beacons. Blank in either box is
 * that rule with nobody having said otherwise — the placeholder shows what it comes to — and the
 * tooltips carry the whole layout, beacons included, which is why no beacon count is drawn on the
 * row. Which *tier* either family means is the header's business, so these are counts and never
 * pickers; with no module chosen there — the whole early game — a count buys nothing, and the
 * tooltip says so rather than the box disappearing under the user.
 */
function ModuleBoxes({
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
  const { effects, layout } = entryRun(entry, recipe, machine, modules);

  return (
    <span class="cell-modules">
      <ModuleBox
        family={layout.families.productivity}
        boost={layout.productivity}
        count={entry.productivityModules}
        /* The one cap in the row: a productivity module is only ever in a slot, so asking for more
           than there are is asking for something the game has no way to build. */
        max={layout.slots}
        disabled={!recipe.allowProductivity}
        title={
          recipe.allowProductivity
            ? productivityTitle(layout, effects)
            : 'This recipe takes no productivity, so a productivity module in it would be nothing but its own speed malus.'
        }
        onCount={(count) => onChange({ ...entry, productivityModules: count })}
      />
      <ModuleBox
        family={layout.families.speed}
        boost={layout.speed}
        count={entry.speedModules}
        title={speedTitle(layout, effects)}
        onCount={(count) => onChange({ ...entry, speedModules: count })}
      />
    </span>
  );
}

/**
 * One side's box: which module is being spent, and how many of them. `family` is the module
 * category, which is the machine's answer rather than the effect's — the agricultural modules and
 * the productivity ones are both picked for productivity, and a farm takes the first.
 */
function ModuleBox({
  family,
  boost,
  count,
  max,
  disabled,
  title,
  onCount,
}: {
  family: string;
  boost: Boost;
  count: number | undefined;
  max?: number;
  disabled?: boolean;
  title: string;
  onCount: (count: number | undefined) => void;
}) {
  /* As `CountBox`'s: the box holds what is being typed, so a half-typed number is not rounded out
     from under the caret. */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const auto = count === undefined;

  return (
    <span class={disabled ? 'cell-module is-off' : 'cell-module'} title={title}>
      {/* No module chosen in the header is the early game's answer and not a missing one, so the
          box says which family it is spending and that the family is off, exactly as the picker up
          there does. */}
      {boost.module ? (
        <span
          class="cell-module-icon"
          style={resourceIconStyle(`item:${boost.module}`)}
          aria-hidden="true"
        />
      ) : (
        <UnlitIcon modules={modulesIn(family)} class="cell-module-icon" />
      )}
      <input
        class={auto ? 'cell-module-count is-derived' : 'cell-module-count'}
        type="number"
        min={0}
        max={max}
        step={1}
        disabled={disabled}
        value={draft ?? count ?? ''}
        /* What "auto" comes to, in the placeholder for the same reason the solver's count is:
           it is what would happen, not what was asked for. */
        placeholder={auto ? fmt(boost.wanted) : ''}
        aria-label={`${categoryName(family)} modules`}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          setDraft(raw);
          const asked = parseModules(raw);
          onCount(asked === undefined || max === undefined ? asked : Math.min(asked, max));
        }}
        onBlur={() => setDraft(undefined)}
      />
    </span>
  );
}

/** What the productivity box did: slots, and what the machine made of them. */
function productivityTitle(layout: Layout, effects: Effects): string {
  const boost = layout.productivity;
  const family = categoryName(layout.families.productivity);
  if (!boost.module) {
    return `${sentence(family)} modules for this row. None is chosen in the header, so nothing here is modded yet.`;
  }
  return (
    `${fmt(boost.inMachine)} ${family} modules in the machine — ${outcome(effects)}.` +
    ' Blank fills the slots; no beacon transmits productivity, so this is the whole of it.'
  );
}

/** What the speed box did: the slots productivity left, the beacons the rest took, and the result. */
function speedTitle(layout: Layout, effects: Effects): string {
  const boost = layout.speed;
  const family = categoryName(layout.families.speed);
  if (!boost.module) {
    return `${sentence(family)} modules for this row. None is chosen in the header, so nothing here is modded yet.`;
  }
  const beacons =
    boost.beacons === 0
      ? 'no beacons'
      : `${fmt(boost.inBeacons)} over ${boost.beacons} ${boost.beacons === 1 ? 'beacon' : 'beacons'}` +
        ` at ${fmt(boost.transmission * 100)}% each`;
  const lost = boost.wanted - boost.inMachine - boost.inBeacons;
  const nowhere = lost > 0 ? `, ${fmt(lost)} with nowhere to go` : '';
  return (
    `${fmt(boost.wanted)} ${family} modules: ${fmt(boost.inMachine)} in the machine, ${beacons}${nowhere}` +
    ` — ${outcome(effects)}. Blank fills whatever slots the productivity modules left.`
  );
}

/** A family's name at the front of a sentence; they are all lowercase, as a picker wants them. */
function sentence(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1);
}

/**
 * What the row ends up running at: only the multiplier which is not 1, because a speed-only row
 * quoting "×1 output" and a productivity-only row quoting the speed it did not change are both
 * noise. Nothing survives when the machine applies neither, which is a real answer — modules a
 * machine ignores are modules bought for nothing, and that is worth seeing.
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
