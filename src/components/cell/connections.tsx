import { decimalPlacesForSignificantFigures, fmt } from '../../ts.ts';
import { recipeName, resourceName } from '../../data/index.ts';
import type { Belt, ResourceId } from '../../types.ts';
import { resourceIconStyle } from '../icon.tsx';
import { ResourceIcon } from '../resource.tsx';
import {
  itemRateTotal,
  simplifiedMachineRatio,
  type ConnectionFlow,
  type RecipeConnections,
} from './connection-calc.ts';

/** The two compact columns below an expanded recipe row. */
export function RecipeConnections({
  connections,
  solved,
  belt,
  recipe,
  onSelectResource,
}: {
  connections: RecipeConnections;
  solved: boolean;
  /** The selected item belt; fluids deliberately have no belt equivalent here. */
  belt: Belt;
  recipe: string;
  onSelectResource: (resource: ResourceId) => void;
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
      <ConnectionSection
        title="Inputs"
        flows={connections.inputs}
        belt={belt}
        recipe={recipe}
        onSelectResource={onSelectResource}
      />
      <ConnectionSection
        title="Outputs"
        flows={connections.outputs}
        belt={belt}
        recipe={recipe}
        onSelectResource={onSelectResource}
      />
    </div>
  );
}

function ConnectionSection({
  title,
  flows,
  belt,
  recipe,
  onSelectResource,
}: {
  title: string;
  flows: ConnectionFlow[];
  belt: Belt;
  recipe: string;
  onSelectResource: (resource: ResourceId) => void;
}) {
  return (
    <section class="cell-connection-section">
      <h3 class="cell-connection-section-title">{title}</h3>
      <ConnectionTable
        flows={flows}
        belt={belt}
        recipe={recipe}
        onSelectResource={onSelectResource}
      />
    </section>
  );
}

function ConnectionTable({
  flows,
  belt,
  recipe,
  onSelectResource,
}: {
  flows: ConnectionFlow[];
  belt: Belt;
  recipe: string;
  onSelectResource: (resource: ResourceId) => void;
}) {
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
  const tableClass =
    'cell-connection-table' +
    (rateDecimalPlaces > 0 ? ' has-rate-fractions' : '') +
    (transportDecimalPlaces > 0 ? ' has-transport-fractions' : '');
  const fractionWidths =
    `--cell-connection-rate-fraction-width: ${rateDecimalPlaces}ch; ` +
    `--cell-connection-transport-fraction-width: ${transportDecimalPlaces}ch`;

  return (
    <div class={tableClass} style={fractionWidths}>
      {flows.map((flow) => (
        <ConnectionRow
          flow={flow}
          total={total}
          belt={belt}
          recipe={recipe}
          rateDecimalPlaces={rateDecimalPlaces}
          transportDecimalPlaces={transportDecimalPlaces}
          onSelectResource={onSelectResource}
          key={flow.resource}
        />
      ))}
    </div>
  );
}

function ConnectionRow({
  flow: { resource, rate, connectedMachineCount, machineCount, connectedRecipes },
  total,
  belt,
  recipe,
  rateDecimalPlaces,
  transportDecimalPlaces,
  onSelectResource,
}: {
  flow: ConnectionFlow;
  total: number;
  belt: Belt;
  recipe: string;
  rateDecimalPlaces: number;
  transportDecimalPlaces: number;
  onSelectResource: (resource: ResourceId) => void;
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
      <button
        type="button"
        class="cell-connection-item cell-btn"
        title={`${fullRate}/s ${resourceName(resource)} (${resource})`}
        aria-label={`Show recipes for ${resourceName(resource)}`}
        onClick={() => onSelectResource(resource)}
      >
        <ResourceIcon id={resource} />
        <span>{resourceName(resource)}</span>
      </button>
      <ConnectionRate rate={rate} decimalPlaces={rateDecimalPlaces} />
      <MachineRatio
        connectedMachineCount={connectedMachineCount}
        machineCount={machineCount}
        connectedRecipes={connectedRecipes}
        recipe={recipe}
      />
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

function MachineRatio({
  connectedMachineCount,
  machineCount,
  connectedRecipes,
  recipe,
}: {
  connectedMachineCount: number | undefined;
  machineCount: number | undefined;
  connectedRecipes: string[] | undefined;
  recipe: string;
}) {
  if (connectedMachineCount === undefined || machineCount === undefined) {
    return <span class="cell-connection-machine-ratio" />;
  }
  const ratio = simplifiedMachineRatio(connectedMachineCount, machineCount);
  const [connectedRatio, machineRatio] = ratio.split(':');
  const connectedRecipe = connectedRecipes?.map(recipeName).join(', ') ?? 'connected';
  const connectedAssemblers = `${connectedRatio} ${connectedRecipe} assembler${
    connectedRatio === '1' ? '' : 's'
  }`;
  const machinePrefix = machineRatio === '1' ? '' : `${machineRatio} `;
  const machineAssemblers = `${machinePrefix}${recipeName(recipe)} assembler${
    machineRatio === '1' ? '' : 's'
  }`;
  return (
    <span
      class="cell-connection-machine-ratio"
      title={`${connectedAssemblers} per ${machineAssemblers}`}
      aria-label={`${ratio} machines`}
    >
      {ratio}
    </span>
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
  const perBelt = `${fmt(belt.itemsPerSecond)}/s each`;
  return (
    <span
      class="cell-connection-belts"
      title={`${count.toFixed(2)} ${human}${count === 1 ? '' : 's'} at ${perBelt}`}
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
