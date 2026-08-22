import type {
  Ingredient,
  IngredientTemperature,
  Product,
  ProductAmount,
  ResourceId,
} from '../types.ts';
import type { RecipeMatch } from '../search.ts';
import { iconStyle } from './icon.tsx';
import { ResourceButton } from './resource.tsx';

/** Crafting speed we quote rates at, until we have building data. */
const CRAFTING_SPEED = 1;

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
  const crafts = CRAFTING_SPEED / recipe.duration;
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
      <table class="recipe-flows">
        <tbody>
          {recipe.ingredients.map((ingredient, i) => (
            <FlowRow
              key={`in-${ingredient.resource}-${i}`}
              dir={i === 0 ? 'in' : undefined}
              flow={ingredientFlow(ingredient, crafts)}
              onPick={onPick}
            />
          ))}
          {recipe.products.map((product, i) => (
            <FlowRow
              key={`out-${product.resource}-${i}`}
              dir={i === 0 ? 'out' : undefined}
              flow={productFlow(product, crafts)}
              onPick={onPick}
            />
          ))}
        </tbody>
      </table>
      {/* building details: available assemblers and modules, once we ingest them */}
    </div>
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
