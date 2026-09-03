import {
  beaconName,
  beaconTiers,
  beaconWorth,
  defaultBeacon,
  staticData,
  type BeaconChoice,
} from '../data/index.ts';
import { useMenu } from './menu.ts';
import { fmt, type State } from '../ts.ts';
import type { Beacon, BeaconId } from '../types.ts';
import { resourceIconStyle } from './icon.tsx';

/**
 * Which beacon a row builds when its speed modules overflow the machine, as a dropdown: the header
 * has one of these next to the module pickers, and it is the same control for the same reason —
 * which beacon you tile a factory with is a fact about the save rather than about any one row, and
 * a cell is a column of rows with no room to ask it of each.
 *
 * It wears the `.module-*` classes rather than a set of its own: the difference between the two is
 * what the icons are, and a beacon picker which did not sit flush with the module pickers beside it
 * would be a worse control for no reason. `module.css` is where they live.
 *
 * The row will get a beacon count of its own eventually — how many reach this machine is a fact
 * about a floor plan, and the app has no floor plan — but that is a different question from this
 * one, which is which beacon has been researched and built.
 */
export function BeaconPicker({
  beacon: [choice, setChoice],
  progress,
}: {
  /** What the user picked: a beacon, `null` for none, or absent for auto. */
  beacon: State<BeaconChoice>;
  progress: number;
}) {
  const { open, setOpen, box } = useMenu();

  if (beaconTiers.length === 0) return null;

  const pinned = choice !== undefined;
  /* The beacon in use, whether it was pinned or defaulted; `undefined` is none, which is both what
     `null` means and what the early game defaults to. A pinned id the dataset no longer has is none
     too — a stale URL, and the same answer `chosenBeacon` gives the arithmetic. */
  const current = pinned ? beaconTiers.find(({ id }) => id === choice) : defaultBeacon(progress);
  const what = current ? `${beaconName(current.id)}: ${slotSummary(current.beacon)}` : 'No beacons';
  const label = pinned ? what : `${what}, by default for this progress`;

  const choose = (id: BeaconChoice) => {
    setChoice(id);
    setOpen(false);
  };

  return (
    <div class="module-picker" ref={box}>
      <button
        type="button"
        class={pinned ? 'module is-active' : 'module'}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label} — click to change`}
        onClick={() => setOpen(!open)}
      >
        {current ? (
          <>
            <span class="module-icon" style={beaconIconStyle(current.id)} aria-hidden="true" />
            <span class="module-effect">{worth(current.beacon)}</span>
          </>
        ) : (
          <>
            <UnlitBeacon class="module-icon" />
            <span class="module-effect">—</span>
          </>
        )}
        <span class="module-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div class="module-menu" role="listbox" aria-label="Beacon">
          {/* As the module pickers' "auto", and it moves the same way: whichever beacon you could
              have built by now, which is a bigger one as the game goes on. */}
          <button
            type="button"
            class={pinned ? 'module-option' : 'module-option is-chosen'}
            role="option"
            aria-selected={!pinned}
            title="Whichever beacon you could have built by now"
            onClick={() => choose(undefined)}
          >
            <span class="module-icon" aria-hidden="true" />
            <span class="module-option-effect">—</span>
            <span class="module-option-name">auto</span>
          </button>
          {/* What "auto" is for the whole early game, and a real choice after it: speed modules go
              in the machine's own slots and nowhere else. */}
          <button
            type="button"
            class={
              choice === null
                ? 'module-option is-chosen'
                : !pinned && !current
                  ? 'module-option is-default'
                  : 'module-option'
            }
            role="option"
            aria-selected={choice === null}
            title="No beacons, however far through the game you are: speed modules go in the machine's own slots and nowhere else"
            onClick={() => choose(null)}
          >
            <UnlitBeacon class="module-icon" />
            <span class="module-option-effect">—</span>
            <span class="module-option-name">none</span>
          </button>
          {beaconTiers.map(({ id, beacon }) => (
            <button
              key={id}
              type="button"
              class={
                choice === id
                  ? 'module-option is-chosen'
                  : !pinned && current?.id === id
                    ? 'module-option is-default'
                    : 'module-option'
              }
              role="option"
              aria-selected={choice === id}
              title={`${id}: ${slotSummary(beacon)}`}
              onClick={() => choose(id)}
            >
              <span class="module-icon" style={beaconIconStyle(id)} aria-hidden="true" />
              <span class="module-option-effect">{worth(beacon)}</span>
              <span class="module-option-name">{beaconName(id)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What one beacon is worth, as the number the picker quotes: how many modules' worth of effect a
 * full one transmits. Every beacon in this pack transmits the same 150%, so the slot count is the
 * whole of the difference between the tiers — but `×3` says what that is *for* in a way `2 slots`
 * does not, and it cannot be misread as a count of beacons, which is a number this app has too.
 *
 * Before the penalty for building more than one, which is the row's business; see `moduleBoost`.
 */
const worth = (beacon: Beacon): string => `×${fmt(beaconWorth(beacon))}`;

/** The same, spelled out for a tooltip: where the number came from. */
function slotSummary(beacon: Beacon): string {
  const slots = `${beacon.moduleSlots} module ${beacon.moduleSlots === 1 ? 'slot' : 'slots'}`;
  return (
    `${slots} at ${fmt(beacon.distributionEffectivity * 100)}% each` +
    ` — ${fmt(beaconWorth(beacon))} modules' worth per beacon, before the penalty for building more`
  );
}

/** A beacon is placed by an item, and the spritesheet is keyed by item; as `machineIconStyle`. */
function beaconIconStyle(id: BeaconId): string {
  return resourceIconStyle(`item:${staticData.beacons[id]?.item ?? id}`);
}

/**
 * "None" wearing the cheapest beacon's artwork with its lights put out — `UnlitIcon`'s job for the
 * module pickers, and here for the same reason: an empty box would leave the picker's row of icons
 * with a hole in it where the control still is.
 */
function UnlitBeacon({ class: box }: { class: string }) {
  const cheapest = beaconTiers[0];
  return (
    <span
      class={`${box} is-unlit`}
      style={cheapest ? beaconIconStyle(cheapest.id) : undefined}
      aria-hidden="true"
    />
  );
}
