import './recipe.css';
import type { MachineId, ResourceId } from '../types.ts';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { RecipeMatch } from '../search.ts';
import { defaultMachine, machinesFor, type MachineMatch } from '../data/machines.ts';
import { flowTitle, recipeFlows, speedOf, type Flow } from '../flow.ts';
import { recipeIconStyle } from './icon.tsx';
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
}: {
  match: RecipeMatch;
  onPick: (id: ResourceId) => void;
  /** Put this recipe, in the selected machine, in the cell being worked on. */
  onAdd?: (machine: MachineId | undefined) => void;
  /** Whether that cell already runs it, in which case the button says so instead of repeating it. */
  inCell?: boolean;
  /** Overall game progress, used to choose the card's unselected machine. */
  progress: number;
}) {
  const [open, setOpen] = useState(false);
  /** The machine chosen from this card, whose speed its numbers are quoted at. */
  const [selectedMachine, setSelectedMachine] = useState<MachineId | undefined>(undefined);
  /** The machine under the pointer, which temporarily previews its rates. */
  const [hoveredMachine, setHoveredMachine] = useState<MachineId | undefined>(undefined);
  const machines = machinesFor(recipe);
  const defaultMachineId = defaultMachine(machines, progress)?.id;
  const displayedMachine = hoveredMachine ?? selectedMachine ?? defaultMachineId;
  const speed = speedOf(machines, displayedMachine);
  const { ins, outs } = recipeFlows(recipe, machines, speed);

  const classes = ['recipe-card'];
  if (hoveredMachine !== undefined || selectedMachine !== undefined) classes.push('is-previewing');
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
      />
    </div>
  );
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

/** The folded form: `2/s [iron] , 8/s [water] → 4/s [plate]`, names and amounts in tooltips. */
function FlowSummary({ ins, outs }: { ins: Flow[]; outs: Flow[] }) {
  return (
    <p class="flow-summary">
      <FlowChips flows={ins} />
      <span class="flow-arrow" aria-label="makes">
        →
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
          {i === 0 ? null : <span class="flow-chip-sep">,</span>}
          <span class="flow-chip" title={flowTitle(flow)}>
            <span class="flow-chip-rate">
              {flow.rate}
              <span class="flow-chip-unit">/s</span>
            </span>
            <ResourceIcon id={flow.resource} />
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
}: {
  machines: MachineMatch[];
  allowProductivity: boolean;
  /** The default or selected machine whose numbers the card currently shows. */
  displayedMachine?: MachineId;
  onHover: (id: MachineId | undefined) => void;
  onChoose: (id: MachineId) => void;
}) {
  if (machines.length === 0) return null;

  return (
    <div class="recipe-machines">
      {/* Clearing after the pointer leaves the list rather than each chip avoids a flash through the
          selected/default rates in the gap between adjacent chips. */}
      <div class="machine-list" onMouseLeave={() => onHover(undefined)}>
        {machines.map(({ id, machine }) => (
          <MachineChip
            key={id}
            id={id}
            machine={machine}
            active={id === displayedMachine}
            onClick={() => onChoose(id)}
            onMouseEnter={() => onHover(id)}
          />
        ))}
      </div>
      <ProductivityChip allowed={allowProductivity} />
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
      <td class="flow-rate">{flow.rate}/s</td>
    </tr>
  );
}
