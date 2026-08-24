import './modules.css';
import { useState } from 'preact/hooks';
import { entryRun, parseModules, type CellEntry } from '../../cell.ts';
import { categoryName, modulesIn, type ChosenModules } from '../../data.ts';
import type { Boost, Effects, Layout } from '../../flow.ts';
import { fmt } from '../../ts.ts';
import type { MachineId, Recipe } from '../../types.ts';
import { resourceIconStyle } from '../icon.tsx';
import { UnlitIcon } from '../module.tsx';

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
export function ModuleBoxes({
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
  /* A pump takes no modules at all — no slots, so no beacon reaches it either — and neither box is
     a question worth asking there. The whole control goes with them, border and all. */
  const nothing = !layout.reaches.productivity && !layout.reaches.speed;

  return (
    <span class={nothing ? 'cell-modules is-hidden' : 'cell-modules'}>
      <ModuleBox
        family={layout.families.productivity}
        boost={layout.productivity}
        count={entry.productivityModules}
        /* The one cap in the row: a productivity module is only ever in a slot, so asking for more
           than there are is asking for something the game has no way to build. */
        max={layout.slots}
        /* Nothing to ask for where the productivity would go nowhere — a recipe which does not
           allow it, a machine which ignores it, a machine with no slots — so the box goes invisible
           rather than away, and the speed boxes down the cell stay in one column. */
        hidden={!layout.reaches.productivity}
        title={productivityTitle(layout, effects)}
        onCount={(count) => onChange({ ...entry, productivityModules: count })}
      />
      <ModuleBox
        family={layout.families.speed}
        boost={layout.speed}
        count={entry.speedModules}
        hidden={!layout.reaches.speed}
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
  hidden,
  title,
  onCount,
}: {
  family: string;
  boost: Boost;
  count: number | undefined;
  max?: number;
  /** Keep the space, show nothing: there is nothing here to ask for. */
  hidden?: boolean;
  title: string;
  onCount: (count: number | undefined) => void;
}) {
  /* As `CountBox`'s: the box holds what is being typed, so a half-typed number is not rounded out
     from under the caret. */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const auto = count === undefined;

  return (
    <span
      class={hidden ? 'cell-module is-hidden' : 'cell-module'}
      title={hidden ? undefined : title}
    >
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
        disabled={hidden}
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
