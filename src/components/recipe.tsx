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
import { bareName, type RecipeMatch } from '../search.ts';
import { machineName, machinesFor, resourceName } from '../data.ts';
import { iconStyle } from './icon.tsx';
import { ResourceButton, ResourceIcon } from './resource.tsx';

/** Crafting speed we quote rates at, until we have building data. */
const CRAFTING_SPEED = 1;

/** Machines with no item of their own to borrow an icon from, and what stands in instead. */
const MACHINE_ICON_STANDIN: Record<MachineId, ResourceId> = {
  character: 'item:light-armor',
};

interface Flow {
  resource: ResourceId;
  /** Per craft, e.g. `2` or `1–3`. */
  amount: string;
  /** Per second, at {@link CRAFTING_SPEED}. */
  rate: number;
  note?: string;
}

export function RecipeCard({
  match: { id, recipe, name },
  onPick,
}: {
  match: RecipeMatch;
  onPick: (id: ResourceId) => void;
}) {
  const [open, setOpen] = useState(false);
  const crafts = CRAFTING_SPEED / recipe.duration;
  const ins = recipe.ingredients.map((ingredient) => ingredientFlow(ingredient, crafts));
  const outs = recipe.products.map((product) => productFlow(product, crafts));

  return (
    <div class="recipe-card">
      <div class="recipe-head">
        <span
          class="recipe-icon"
          style={iconStyle(`recipe:${id}`, 'recipe:recipe-unknown')}
          aria-hidden="true"
        />
        <span class="recipe-name" title={id}>
          {name}
        </span>
        <span class="recipe-duration">{fmt(recipe.duration)}s</span>
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
      <MachineRow recipe={recipe} />
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
              {fmt(flow.rate)}
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
 */
function MachineRow({ recipe }: { recipe: Recipe }) {
  const machines = machinesFor(recipe);
  if (machines.length === 0) return null;

  return (
    <div class="recipe-machines">
      {machines.map(({ id, machine }) => (
        <span
          key={id}
          class="machine"
          title={`${machineName(id)} (${id}) at ${fmt(machine.speed)}×`}
        >
          <span class="machine-icon" style={machineIconStyle(id)} aria-hidden="true" />
          <span class="machine-speed">{fmt(machine.speed)}×</span>
        </span>
      ))}
    </div>
  );
}

function machineIconStyle(id: MachineId): string {
  const standin = MACHINE_ICON_STANDIN[id];
  return iconStyle(
    `craft:${id}`,
    ...(standin ? [`craft:${bareName(standin)}`] : []),
    'craft:item-unknown',
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
      <td class="flow-rate">{fmt(flow.rate)}/s</td>
    </tr>
  );
}

function ingredientFlow(ingredient: Ingredient, crafts: number): Flow {
  return {
    resource: ingredient.resource,
    amount: fmt(ingredient.amount),
    rate: ingredient.amount * crafts,
    note: ingredient.temperature && temperatureNote(ingredient.temperature),
  };
}

function productFlow(product: Product, crafts: number): Flow {
  const expected = averageAmount(product.amount) * product.probability;
  return {
    resource: product.resource,
    amount: amountLabel(product.amount),
    rate: expected * crafts,
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

/** A number with enough precision to be useful, and no more. */
export function fmt(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 3;
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
