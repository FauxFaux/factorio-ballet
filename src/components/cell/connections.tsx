import { decimalPlacesForSignificantFigures, fmt } from '../../ts.ts';
import { resourceName } from '../../data/index.ts';
import type { Belt } from '../../types.ts';
import { resourceIconStyle } from '../icon.tsx';
import { ResourceIcon } from '../resource.tsx';
import { itemRateTotal, type ConnectionFlow, type RecipeConnections } from './connection-calc.ts';

/** The two compact columns below an expanded recipe row. */
export function RecipeConnections({
  connections,
  solved,
  belt,
}: {
  connections: RecipeConnections;
  solved: boolean;
  /** The selected item belt; fluids deliberately have no belt equivalent here. */
  belt: Belt;
}) {
  if (!solved) {
    return (
      <p class="cell-connections cell-recipe-connections cell-connections-pending">
        Connections appear once this row is worked out.
      </p>
    );
  }
  return (
    <div class="cell-connections cell-recipe-connections">
      <ConnectionSection title="Inputs" flows={connections.inputs} belt={belt} />
      <ConnectionSection title="Outputs" flows={connections.outputs} belt={belt} />
    </div>
  );
}

function ConnectionSection({
  title,
  flows,
  belt,
}: {
  title: string;
  flows: ConnectionFlow[];
  belt: Belt;
}) {
  return (
    <section class="cell-connection-section">
      <h3 class="cell-connection-section-title">{title}</h3>
      <ConnectionTable flows={flows} belt={belt} />
    </section>
  );
}

function ConnectionTable({ flows, belt }: { flows: ConnectionFlow[]; belt: Belt }) {
  const total = itemRateTotal(flows);
  const rateDecimalPlaces = decimalPlacesForSignificantFigures(
    Math.max(...flows.map((flow) => flow.rate)),
    3,
  );
  const transportDecimalPlaces = Math.min(
    2,
    decimalPlacesForSignificantFigures(
      Math.max(...flows.map((flow) => transportCount(flow, belt))),
      3,
    ),
  );

  return (
    <div
      class={`cell-connection-table${rateDecimalPlaces > 0 ? ' has-rate-fractions' : ''}${transportDecimalPlaces > 0 ? ' has-transport-fractions' : ''}`}
      style={`--cell-connection-rate-fraction-width: ${rateDecimalPlaces}ch; --cell-connection-transport-fraction-width: ${transportDecimalPlaces}ch`}
    >
      {flows.map((flow) => (
        <ConnectionRow
          flow={flow}
          total={total}
          belt={belt}
          rateDecimalPlaces={rateDecimalPlaces}
          transportDecimalPlaces={transportDecimalPlaces}
          key={flow.resource}
        />
      ))}
    </div>
  );
}

function ConnectionRow({
  flow: { resource, rate },
  total,
  belt,
  rateDecimalPlaces,
  transportDecimalPlaces,
}: {
  flow: ConnectionFlow;
  total: number;
  belt: Belt;
  rateDecimalPlaces: number;
  transportDecimalPlaces: number;
}) {
  const isItem = resource.startsWith('item:');
  const proportion = isItem && total > 0 ? Math.min(rate / total, 1) : 0;
  const share = `${fmt(proportion * 100)}% of total`;
  const fullRate = rate.toFixed(5);
  return (
    <div class="cell-connection-row">
      {isItem ? (
        <span class="cell-connection-distribution" title={share} aria-label={share}>
          <span style={`height: ${proportion * 100}%`} aria-hidden="true" />
        </span>
      ) : (
        /* The table uses a four-column grid. Keep this blank cell so fluid rows do not shift. */
        <span aria-hidden="true" />
      )}
      <span
        class="cell-connection-item"
        title={`${fullRate}/s ${resourceName(resource)} (${resource})`}
      >
        <ResourceIcon id={resource} />
        <span>{resourceName(resource)}</span>
      </span>
      <ConnectionRate rate={rate} decimalPlaces={rateDecimalPlaces} />
      <span class="cell-connection-transport">
        {resource.startsWith('item:') ? (
          <BeltCount rate={rate} belt={belt} decimalPlaces={transportDecimalPlaces} />
        ) : (
          <PumpCount rate={rate} decimalPlaces={transportDecimalPlaces} />
        )}
      </span>
    </div>
  );
}

function ConnectionRate({ rate, decimalPlaces }: { rate: number; decimalPlaces: number }) {
  const [whole, fraction] = rate.toFixed(decimalPlaces).split('.');
  return (
    <span class="cell-connection-rate" title={`${rate.toFixed(5)}/s`}>
      <span class="cell-connection-rate-value">
        <span>{whole}</span>
        {fraction !== undefined && (
          <>
            <span class="cell-connection-rate-point">.</span>
            <span>{fraction}</span>
          </>
        )}
      </span>
      /s
    </span>
  );
}

function transportCount({ resource, rate }: ConnectionFlow, belt: Belt): number {
  return rate / (resource.startsWith('item:') ? belt.itemsPerSecond : 1200);
}

/** The selected belt's share of an item flow; fluids travel by pipes, so never reach this. */
function BeltCount({
  rate,
  belt,
  decimalPlaces,
}: {
  rate: number;
  belt: Belt;
  decimalPlaces: number;
}) {
  const count = rate / belt.itemsPerSecond;
  const human = belt.human ?? belt.item ?? 'belt';
  return (
    <span
      class="cell-connection-belts"
      title={`${count.toFixed(2)} ${human}${count === 1 ? '' : 's'} at ${fmt(belt.itemsPerSecond)}/s each`}
    >
      <TransportValue count={count} decimalPlaces={decimalPlaces} />
      <span
        class="cell-connection-belt-icon"
        style={resourceIconStyle(`item:${belt.item ?? 'belt-unknown'}`)}
        aria-hidden="true"
      />
    </span>
  );
}

function PumpCount({ rate, decimalPlaces }: { rate: number; decimalPlaces: number }) {
  const pumps = rate / 1200;
  return (
    <span class="cell-connection-pump" title={`${pumps.toFixed(2)} pumps`}>
      <TransportValue count={pumps} decimalPlaces={decimalPlaces} />
      <span
        class="cell-connection-belt-icon"
        style={resourceIconStyle(`item:pump`)}
        aria-hidden="true"
      />
    </span>
  );
}

function TransportValue({ count, decimalPlaces }: { count: number; decimalPlaces: number }) {
  const [whole, fraction] = count.toFixed(decimalPlaces).split('.');
  return (
    <span class="cell-connection-transport-value">
      <span>{whole}</span>
      {fraction !== undefined && (
        <>
          <span class="cell-connection-transport-point">.</span>
          <span>{fraction}</span>
        </>
      )}
    </span>
  );
}
