import './recipe.css';
import type { MachineId, ResourceId } from '../types.ts';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { RecipeMatch } from '../search.ts';
import { NO_CHOICE, type Chosen } from '../data/index.ts';
import { defaultMachine, machinesFor, type MachineMatch } from '../data/machines.ts';
import { flowTitle, laidOutEffects, recipeFlows, speedOf, type Flow } from '../flow.ts';
import { recipeIconStyle, resourceIconStyle } from './icon.tsx';
import { MachineChip } from './machine.tsx';
import { ResourceButton, ResourceIcon } from './resource.tsx';

/**
 * The tier-1 productivity module, whose icon stands for "productivity applies here". This pack
 * keeps the vanilla naming, so tier 1 is unsuffixed and `productivity-module-1` does not exist.
 */
const PRODUCTIVITY_MODULE: ResourceId = 'item:productivity-module';

/** Durations are one number in a row of its own, so a plain two decimals is enough. */
const DURATION_DIGITS = 2;

export function RecipeCard({
  match: { id, recipe, name },
  onPick,
  onAdd,
  inCell,
  progress,
  chosen,
}: {
  match: RecipeMatch;
  onPick: (id: ResourceId) => void;
  /** Put this recipe, in the selected machine, in the cell being worked on. */
  onAdd?: (machine: MachineId | undefined) => void;
  /** Whether that cell already runs it, in which case the button says so instead of repeating it. */
  inCell?: boolean;
  /** Overall game progress, used to choose the card's unselected machine. */
  progress: number;
  /** The header's modules and beacon, used to preview a beaconed default machine. */
  chosen?: Chosen;
}) {
  const [open, setOpen] = useState(false);
  /** The machine chosen from this card, whose speed its numbers are quoted at. */
  const [selectedMachine, setSelectedMachine] = useState<MachineId | undefined>(undefined);
  /** The machine under the pointer, which temporarily previews its rates. */
  const [hoveredMachine, setHoveredMachine] = useState<MachineId | undefined>(undefined);
  /** The beacon count under the pointer, or the count selected with a click. */
  const [hoveredBeacons, setHoveredBeacons] = useState<number | undefined>(undefined);
  const [selectedBeacons, setSelectedBeacons] = useState<number | undefined>(undefined);
  const machines = machinesFor(recipe);
  const defaultMachineId = defaultMachine(machines, progress)?.id;
  /* A machine under the pointer is a direct comparison with its unmodded rate. Keep a clicked
     beacon choice ready to resume afterwards, but do not combine it with that comparison. */
  const beaconCount =
    hoveredMachine === undefined ? (hoveredBeacons ?? selectedBeacons) : undefined;
  /* A beacon preview intentionally starts from the automatic assembler, rather than augmenting a
     machine the user happened to inspect. It is a compact comparison with the card's baseline. */
  const displayedMachine = beaconCount
    ? defaultMachineId
    : (hoveredMachine ?? selectedMachine ?? defaultMachineId);
  const baseSpeed = speedOf(machines, displayedMachine);
  const beaconSpeed = beaconCount
    ? beaconedSpeed(machines, defaultMachineId, recipe, chosen ?? NO_CHOICE, beaconCount)
    : 1;
  const speed = baseSpeed * beaconSpeed;
  const { ins, outs } = recipeFlows(recipe, machines, speed);

  const classes = ['recipe-card'];
  if (
    hoveredMachine !== undefined ||
    selectedMachine !== undefined ||
    hoveredBeacons !== undefined ||
    selectedBeacons !== undefined
  ) {
    classes.push('is-previewing');
  }
  if (recipe.synthetic) classes.push('is-synthetic');

  return (
    <div class={classes.join(' ')}>
      <div class="recipe-head">
        <span class="recipe-icon" style={recipeIconStyle(id, recipe)} aria-hidden="true" />
        <span class="recipe-name" title={id}>
          {name}
        </span>
        {recipe.synthetic ? <SyntheticChip /> : null}
        <span class="recipe-duration">{(recipe.duration / speed).toFixed(DURATION_DIGITS)}s</span>
        {onAdd ? <AddToCell onAdd={() => onAdd(selectedMachine)} inCell={inCell ?? false} /> : null}
      </div>
      <div class="recipe-flows-fold">
        <button
          type="button"
          class="fold-toggle"
          aria-expanded={open}
          title={open ? 'Fold the ingredients' : 'Unfold the ingredients'}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        {open ? (
          <FlowTable ins={ins} outs={outs} onPick={onPick} />
        ) : (
          <FlowSummary ins={ins} outs={outs} />
        )}
      </div>
      <MachineRow
        machines={machines}
        allowProductivity={recipe.allowProductivity ?? false}
        displayedMachine={displayedMachine}
        onHover={setHoveredMachine}
        onChoose={(machine) =>
          setSelectedMachine((current) => (current === machine ? undefined : machine))
        }
        beacon={chosen?.beacon}
        beaconCount={beaconCount}
        onBeaconHover={setHoveredBeacons}
        onBeaconChoose={(count) =>
          setSelectedBeacons((current) => (current === count ? undefined : count))
        }
      />
    </div>
  );
}

/** The speed multiplier from full selected beacons around an otherwise unmodded default machine. */
function beaconedSpeed(
  machines: MachineMatch[],
  machineId: MachineId | undefined,
  recipe: RecipeMatch['recipe'],
  chosen: Chosen,
  beacons: number,
): number {
  const machine = machines.find(({ id }) => id === machineId)?.machine;
  if (!machine) return 1;
  return laidOutEffects(
    machine,
    undefined,
    recipe,
    chosen.modules,
    { productivity: 0, speed: 0, beacons },
    chosen.beacon,
  ).effects.speed;
}

/** The unfolded form: a row per flow, with amounts per craft and rates per second. */
function FlowTable({
  ins,
  outs,
  onPick,
}: {
  ins: Flow[];
  outs: Flow[];
  onPick: (id: ResourceId) => void;
}) {
  return (
    <table class="recipe-flows">
      <tbody>
        {ins.map((flow, i) => (
          <FlowRow
            key={`in-${flow.resource}-${i}`}
            dir={i === 0 ? 'in' : undefined}
            flow={flow}
            onPick={onPick}
          />
        ))}
        {outs.map((flow, i) => (
          <FlowRow
            key={`out-${flow.resource}-${i}`}
            dir={i === 0 ? 'out' : undefined}
            flow={flow}
            onPick={onPick}
          />
        ))}
      </tbody>
    </table>
  );
}

/** The folded form: `2.0 [iron] + 8.0 [water] → 4.0 [plate]`, names and amounts in tooltips. */
function FlowSummary({ ins, outs }: { ins: Flow[]; outs: Flow[] }) {
  return (
    <p class="flow-summary">
      <FlowChips flows={ins} />
      <span class="flow-arrow" aria-label="makes">
        ➔
      </span>
      <FlowChips flows={outs} />
    </p>
  );
}

function FlowChips({ flows }: { flows: Flow[] }) {
  return (
    <>
      {flows.map((flow, i) => (
        <Fragment key={`${flow.resource}-${i}`}>
          {i === 0 ? null : <span class="flow-chip-sep">+</span>}
          <span class="flow-chip" title={flowTitle(flow)}>
            <abbr class="flow-chip-rate" title={`${flow.fullRate} per second`}>
              {flow.rate}
            </abbr>
            <span class="flow-chip-icon">
              <ResourceIcon id={flow.resource} />
            </span>
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * The machines which can run this recipe, each labelled with its crafting speed: the multiplier to
 * apply to the default machine's rates above. Hovering one previews it; choosing one keeps it as
 * the card's selection and adds the recipe with that machine.
 */
function MachineRow({
  machines,
  allowProductivity,
  displayedMachine,
  onHover,
  onChoose,
  beacon,
  beaconCount,
  onBeaconHover,
  onBeaconChoose,
}: {
  machines: MachineMatch[];
  allowProductivity: boolean;
  /** The default or selected machine whose numbers the card currently shows. */
  displayedMachine?: MachineId;
  onHover: (id: MachineId | undefined) => void;
  onChoose: (id: MachineId) => void;
  /** Omitted until the header has a beacon to put round this machine. */
  beacon: Chosen['beacon'];
  /** The hovered or selected count, whose icons and default machine are active. */
  beaconCount: number | undefined;
  onBeaconHover: (count: number | undefined) => void;
  onBeaconChoose: (count: number) => void;
}) {
  if (machines.length === 0) return null;

  return (
    <div class="recipe-machines">
      {/* Clearing after the pointer leaves the combined choices rather than each chip avoids a
          flash through the selected/default rates in their gaps. */}
      <div
        class="machine-list"
        onMouseLeave={() => {
          onHover(undefined);
          onBeaconHover(undefined);
        }}
      >
        {machines.map(({ id, machine }) => (
          <MachineChip
            key={id}
            id={id}
            machine={machine}
            active={id === displayedMachine}
            compactSpeed
            speedBelow
            onClick={() => onChoose(id)}
            onMouseEnter={() => onHover(id)}
          />
        ))}
        {beacon ? (
          <BeaconButtons
            beacon={beacon}
            active={beaconCount}
            onHover={(count) => {
              onHover(undefined);
              onBeaconHover(count);
            }}
            onChoose={onBeaconChoose}
          />
        ) : null}
      </div>
      <ProductivityChip allowed={allowProductivity} />
    </div>
  );
}

/** Three additive beacon choices, immediately following the machine row in count order. */
function BeaconButtons({
  beacon,
  active,
  onHover,
  onChoose,
}: {
  beacon: NonNullable<Chosen['beacon']>;
  active: number | undefined;
  onHover: (count: number | undefined) => void;
  onChoose: (count: number) => void;
}) {
  return (
    <div class="recipe-beacons">
      {[1, 2, 3].map((count) => {
        const isActive = active !== undefined && count <= active;
        const label = `${count} ${count === 1 ? 'beacon' : 'beacons'} around the default assembler`;
        return (
          <button
            key={count}
            type="button"
            class={isActive ? 'recipe-beacon is-active' : 'recipe-beacon'}
            title={label}
            aria-label={label}
            onMouseEnter={() => onHover(count)}
            onClick={() => onChoose(count)}
          >
            <span
              class="recipe-beacon-icon"
              style={resourceIconStyle(`item:${beacon.item}`)}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Whether productivity bonuses do anything here: the module's icon, ticked when they apply. Most
 * recipes do not allow them, so the unticked state is the common one.
 */
function ProductivityChip({ allowed }: { allowed: boolean }) {
  return (
    <span
      class={allowed ? 'productivity is-allowed' : 'productivity'}
      title={
        allowed
          ? 'Productivity bonuses apply to this recipe'
          : 'Productivity bonuses do not apply to this recipe'
      }
    >
      <ResourceIcon id={PRODUCTIVITY_MODULE} />
      {/* Always rendered, hidden rather than dropped when disallowed, so the chip is one width and
          the machine rows line up down the page. */}
      <span class="productivity-check" aria-hidden="true">
        ✔
      </span>
    </span>
  );
}

/** The one control on a search result: put this recipe in the cell being worked on. */
function AddToCell({ onAdd, inCell }: { onAdd: () => void; inCell: boolean }) {
  return (
    <button
      type="button"
      class={inCell ? 'recipe-add is-in-cell' : 'recipe-add'}
      title={inCell ? 'Already in this cell' : 'Add to this cell'}
      aria-label={inCell ? 'Already in this cell' : 'Add to this cell'}
      disabled={inCell}
      onClick={onAdd}
    >
      {inCell ? '✓' : '+'}
    </button>
  );
}

/**
 * Says out loud that this card is not a recipe: nothing in the game's data describes it, and you
 * will not find it in the crafting menu. See `Recipe.synthetic`.
 */
function SyntheticChip() {
  return (
    <span
      class="recipe-synthetic"
      title="Not a recipe: the game makes this without one, from the ground the machine stands on"
    >
      synthetic
    </span>
  );
}

function FlowRow({
  dir,
  flow,
  onPick,
}: {
  dir?: 'in' | 'out';
  flow: Flow;
  onPick: (id: ResourceId) => void;
}) {
  return (
    <tr class={dir === 'out' ? 'flow-out' : undefined}>
      <th scope="row">{dir === 'in' ? 'in' : dir === 'out' ? 'out' : ''}</th>
      <td class="flow-amount">{flow.amount} ×</td>
      <td>
        <ResourceButton id={flow.resource} onPick={onPick} />
        {flow.note ? <span class="flow-note">{flow.note}</span> : null}
      </td>
      <td class="flow-rate">
        <abbr title={`${flow.fullRate} per second`}>{flow.fullRate.toFixed(2)}/s</abbr>
      </td>
    </tr>
  );
}
