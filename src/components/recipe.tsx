import type {
  Ingredient,
  IngredientTemperature,
  MachineId,
  Product,
  ProductAmount,
  Recipe,
  ResourceId,
} from '../types.ts';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { RecipeMatch } from '../search.ts';
import { machinesFor, resourceName, type MachineMatch } from '../data.ts';
import { fmt } from '../ts.ts';
import { recipeIconStyle } from './icon.tsx';
import { MachineChip } from './machine.tsx';
import { ResourceButton, ResourceIcon } from './resource.tsx';

/** Crafting speed we quote rates at, until we have building data. */
const CRAFTING_SPEED = 1;

/**
 * The tier-1 productivity module, whose icon stands for "productivity applies here". This pack
 * keeps the vanilla naming, so tier 1 is unsuffixed and `productivity-module-1` does not exist.
 */
const PRODUCTIVITY_MODULE: ResourceId = 'item:productivity-module';

/**
 * Rates this small would read as `0.00`, so a recipe with one anywhere in reach is quoted an extra
 * digit throughout.
 */
const THREE_DP_BELOW = 0.05;

/** Durations are one number in a row of its own, so a plain two decimals is enough. */
const DURATION_DIGITS = 2;

/** How to render a number whose value depends on the machine previewed. */
type Fmt = (value: number) => string;

interface Flow {
  resource: ResourceId;
  /** Per craft, e.g. `2` or `1–3`. */
  amount: string;
  /** Per second, at the card's current crafting speed, already formatted. */
  rate: string;
  note?: string;
}

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
  const speed = machines.find(({ id }) => id === preview)?.machine.speed ?? CRAFTING_SPEED;
  const crafts = speed / recipe.duration;
  /* Scaled numbers land on far fewer round values than the 1× baseline does, and {@link fmt}'s
   * precision moves with the magnitude, so the numbers changed width — and the summary rewrapped —
   * as the pointer moved along the machine list. Both precisions are decided for the card as a
   * whole instead, so nothing moves whichever machine is previewed. */
  const digits = rateDigits(recipe, machines);
  const rate = (value: number) => value.toFixed(digits);
  const ins = recipe.ingredients.map((ingredient) => ingredientFlow(ingredient, crafts, rate));
  const outs = recipe.products.map((product) => productFlow(product, crafts, rate));

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

function flowTitle(flow: Flow): string {
  const note = flow.note ? `, ${flow.note}` : '';
  return `${resourceName(flow.resource)}: ${flow.amount} per craft${note}`;
}

/**
 * The machines which can run this recipe, each labelled with its crafting speed; the recipe's
 * rates above are quoted at {@link CRAFTING_SPEED}, so the speed is the multiplier to apply.
 * Hovering one applies it, so the card shows that machine's numbers.
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

/**
 * How many decimals this recipe's rates are quoted at, decided once for the card: three if any flow
 * could fall below {@link THREE_DP_BELOW} on any machine it can run on — including the 1× baseline —
 * and two otherwise. Deciding it per number instead let a card wrap to two lines at three decimals
 * and back to one at two.
 */
function rateDigits(recipe: Recipe, machines: MachineMatch[]): number {
  const slowest = Math.min(CRAFTING_SPEED, ...machines.map(({ machine }) => machine.speed));
  const amounts = [
    ...recipe.ingredients.map((ingredient) => ingredient.amount),
    ...recipe.products.map((product) => averageAmount(product.amount) * product.probability),
  ].filter((amount) => amount > 0);
  const smallest = (Math.min(...amounts) * slowest) / recipe.duration;
  return smallest < THREE_DP_BELOW ? 3 : 2;
}

function ingredientFlow(ingredient: Ingredient, crafts: number, rate: Fmt): Flow {
  return {
    resource: ingredient.resource,
    amount: fmt(ingredient.amount),
    rate: rate(ingredient.amount * crafts),
    note: ingredient.temperature && temperatureNote(ingredient.temperature),
  };
}

function productFlow(product: Product, crafts: number, rate: Fmt): Flow {
  const expected = averageAmount(product.amount) * product.probability;
  return {
    resource: product.resource,
    amount: amountLabel(product.amount),
    rate: rate(expected * crafts),
    note: product.probability === 1 ? undefined : `${fmt(product.probability * 100)}%`,
  };
}

function averageAmount(amount: ProductAmount): number {
  return 'fixed' in amount ? amount.fixed : (amount.min + amount.max) / 2;
}

function amountLabel(amount: ProductAmount): string {
  return 'fixed' in amount ? fmt(amount.fixed) : `${fmt(amount.min)}–${fmt(amount.max)}`;
}

function temperatureNote(temperature: IngredientTemperature): string {
  if ('fixed' in temperature) return `at ${fmt(temperature.fixed)}°C`;
  if ('min' in temperature && 'max' in temperature)
    return `${fmt(temperature.min)}–${fmt(temperature.max)}°C`;
  if ('min' in temperature) return `≥${fmt(temperature.min)}°C`;
  return `≤${fmt(temperature.max)}°C`;
}
