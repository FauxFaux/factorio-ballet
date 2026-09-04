import './modules.css';
import { useState } from 'preact/hooks';
import { entryRun, parseModules, type CellEntry } from '../../cell.ts';
import type { Chosen } from '../../data/index.ts';
import { categoryName, modulesIn } from '../../data/modules.ts';
import type { Boost, Effects, Layout } from '../../flow.ts';
import { fmt } from '../../ts.ts';
import type { MachineId, Recipe } from '../../types.ts';
import { resourceIconStyle } from '../icon.tsx';
import { UnlitIcon } from '../unlit-module-icon.tsx';

/**
 * What reaches this row's machine: its productivity modules (or speed modules where productivity
 * is unavailable), then full speed-module beacons. The two columns answer two distinct questions:
 * what goes in slots, and how many beacons reach the machine.
 *
 * Blank in the first box fills its applicable slots. Which *tier* either family means is the
 * header's business, so these are counts and never
 * pickers; with no module chosen there — the whole early game — a count buys nothing, and the
 * tooltip says so rather than the box disappearing under the user.
 */
export function ModuleBoxes({
  entry,
  recipe,
  machine,
  chosen,
  onChange,
}: {
  entry: CellEntry;
  recipe: Recipe;
  machine: MachineId | undefined;
  /** What the header says this row has to spend: modules and a beacon; see `Chosen`. */
  chosen: Chosen;
  onChange: (entry: CellEntry) => void;
}) {
  const { effects, layout } = entryRun(entry, recipe, machine, chosen);
  const inMachine = layout.reaches.productivity ? layout.productivity : layout.speed;
  const inMachineCount = layout.reaches.productivity
    ? entry.productivityModules
    : entry.speedModules;
  /* A pump takes no modules at all — no slots, so no beacon reaches it either — and neither box is
     a question worth asking there. The whole control goes with them, border and all. */
  const nothing = !layout.reaches.productivity && !layout.reaches.speed;

  return (
    <span class={nothing ? 'cell-modules is-hidden' : 'cell-modules'}>
      <ModuleBox
        family={layout.reaches.productivity ? layout.families.productivity : layout.families.speed}
        boost={inMachine}
        count={inMachineCount}
        /* The one cap in the row: a productivity module is only ever in a slot, so asking for more
           than there are is asking for something the game has no way to build. */
        max={layout.slots}
        /* Nothing to ask for where the productivity would go nowhere — a recipe which does not
           allow it, a machine which ignores it, a machine with no slots — so the box goes invisible
           rather than away, and the speed boxes down the cell stay in one column. */
        hidden={!layout.reaches.speed}
        title={inMachineTitle(layout, effects)}
        onCount={(count) =>
          onChange(
            layout.reaches.productivity
              ? { ...entry, productivityModules: count }
              : { ...entry, speedModules: count },
          )
        }
      />
      <BeaconBox
        beacon={chosen.beacon}
        count={entry.beacons}
        hidden={!layout.reaches.speed || !chosen.beacon}
        title={beaconTitle(layout, effects)}
        onCount={(count) => onChange({ ...entry, beacons: count })}
      />
    </span>
  );
}

/** The second column: an explicit count of beacons, each packed with speed modules. */
function BeaconBox({
  beacon,
  count,
  hidden,
  title,
  onCount,
}: {
  beacon: Chosen['beacon'];
  count: number | undefined;
  hidden: boolean;
  title: string;
  onCount: (count: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  return (
    <span
      class={hidden ? 'cell-module is-hidden' : 'cell-module'}
      title={hidden ? undefined : title}
    >
      {beacon ? (
        <span
          class="cell-module-icon"
          style={resourceIconStyle(`item:${beacon.item}`)}
          aria-hidden="true"
        />
      ) : (
        <UnlitIcon modules={modulesIn('speed')} class="cell-module-icon" />
      )}
      <input
        class="cell-module-count"
        type="number"
        min={0}
        step={1}
        disabled={hidden}
        value={draft ?? count ?? 0}
        aria-label="beacons"
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          setDraft(raw);
          onCount(parseModules(raw));
        }}
        onBlur={() => setDraft(undefined)}
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
        /* An auto count is still an actual value here: native number spinners only step values,
           not placeholders. The derived styling says it is what would happen, not what was
           explicitly asked for. */
        value={draft ?? count ?? boost.wanted}
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

/** What the first box did: productivity where available, speed otherwise. */
function inMachineTitle(layout: Layout, effects: Effects): string {
  const productivity = layout.reaches.productivity;
  const boost = productivity ? layout.productivity : layout.speed;
  const family = categoryName(productivity ? layout.families.productivity : layout.families.speed);
  const modules = [
    moduleCount(layout.productivity.inMachine, categoryName(layout.families.productivity)),
    moduleCount(layout.speed.inMachine, categoryName(layout.families.speed)),
  ].filter((module): module is string => module !== undefined);
  if (!modules.length) {
    return boost.module
      ? `No ${family} modules are in the machine — ${outcome(effects)}.`
      : `${sentence(family)} modules for this row. None is chosen in the header, so nothing here is modded yet.`;
  }
  let msg = `In-machine: ${modules.join(' and ')}, giving ${outcome(effects)}.`;
  if (productivity && layout.speed.inMachine > 0) {
    msg +=
      " I'm assuming you only took out the productivity modules because you wanted more speed, so have some speed modules.";
  }

  return msg;
}

/** A computed module count, omitted when that family occupies no machine slots. */
function moduleCount(count: number, family: string): string | undefined {
  if (!count) return undefined;
  return `${fmt(count)} ${family} module${count === 1 ? '' : 's'}`;
}

/** What the beacon box did: every selected beacon is full of the selected speed module. */
function beaconTitle(layout: Layout, effects: Effects): string {
  const boost = layout.speed;
  const family = categoryName(layout.families.speed);
  if (!boost.module) {
    return `${sentence(family)} modules for this row. None is chosen in the header, so nothing here is modded yet.`;
  }
  const rest =
    boost.beacons > 0
      ? `${fmt(boost.inBeacons)} ${family} modules over ${boost.beacons} ${boost.beacons === 1 ? 'beacon' : 'beacons'}` +
        ` at ${fmt(boost.transmission * 100)}% each`
      : 'no beacons';
  return `${rest} — ${outcome(effects)}.`;
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
