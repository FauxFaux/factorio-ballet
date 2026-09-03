import './recipe.css';
import type { MachineId, ResourceId } from '../types.ts';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { RecipeMatch } from '../search.ts';
import { machinesFor, type MachineMatch } from '../data/index.ts';
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
}: {
  match: RecipeMatch;
  onPick: (id: ResourceId) => void;
  /** Put this recipe in the cell being worked on; absent when there is nowhere to put it. */
  onAdd?: () => void;
  /** Whether that cell already runs it, in which case the button says so instead of repeating it. */
  inCell?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** The machine being hovered, whose speed the card's numbers are quoted at. */
  const [preview, setPreview] = useState<MachineId | undefined>(undefined);
  const machines = machinesFor(recipe);
  const speed = speedOf(machines, preview);
  const { ins, outs } = recipeFlows(recipe, machines, speed);

  const classes = ['recipe-card'];
  if (preview !== undefined) classes.push('is-previewing');
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
        {onAdd ? <AddToCell onAdd={onAdd} inCell={inCell ?? false} /> : null}
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
        preview={preview}
        onPreview={setPreview}
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
 * apply to the 1× rates above. Hovering one applies it, so the card shows that machine's numbers.
 */
function MachineRow({
  machines,
  allowProductivity,
  preview,
  onPreview,
}: {
  machines: MachineMatch[];
  allowProductivity: boolean;
  preview?: MachineId;
  onPreview: (id: MachineId | undefined) => void;
}) {
  if (machines.length === 0) return null;

  return (
    <div class="recipe-machines">
      {/* The preview is cleared when the pointer leaves the whole list, not when it leaves a chip:
          the gaps between chips are dead space, and clearing there would flash the card back to the
          1× numbers on the way to the next machine. */}
      <div class="machine-list" onMouseLeave={() => onPreview(undefined)}>
        {machines.map(({ id, machine }) => (
          <MachineChip
            key={id}
            id={id}
            machine={machine}
            active={id === preview}
            onMouseEnter={() => onPreview(id)}
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
