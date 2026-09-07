import { recipeName, resourceName, staticData } from '../../data/index.ts';
import { decimalPlacesForSignificantFigures, fmt } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import { recipeIconStyle } from '../icon.tsx';
import type { InternalConnections, InternalFlow } from './internal-calc.ts';

/** The recipe flow breakdown shown when an in-play resource is expanded. */
export function InPlayConnectionsView({
  id,
  connections,
  inputRate,
  outputRate,
  solved,
  forcedExport = false,
  forcedImport = false,
  onToggleImport,
  onToggleExport,
  imbalance,
  onRecipeHover,
  onSearch,
}: {
  id: ResourceId;
  connections: InternalConnections;
  inputRate: number | undefined;
  outputRate: number | undefined;
  solved: boolean;
  forcedExport?: boolean;
  forcedImport?: boolean;
  onToggleImport?: () => void;
  onToggleExport?: () => void;
  imbalance?: number;
  onRecipeHover: (recipe: string | undefined) => void;
  onSearch: (search: string) => void;
}) {
  const resource = staticData.resources[id];
  const details = (
    <ResourceDetails
      id={id}
      stackSize={resource?.stackSize}
      onSearch={onSearch}
      forcedExport={forcedExport}
      forcedImport={forcedImport}
      onToggleImport={onToggleImport}
      onToggleExport={onToggleExport}
      imbalance={imbalance}
    />
  );

  if (!solved) {
    return (
      <div class="cell-connections cell-connections-pending">
        {details}
        Recipes appear once the cell is worked out.
      </div>
    );
  }
  return (
    <div class="cell-connections cell-in-play-connections">
      {details}
      <InPlayConnectionTable
        outputs={connections.outputs}
        inputs={connections.inputs}
        inputRate={inputRate}
        outputRate={outputRate}
        onRecipeHover={onRecipeHover}
      />
    </div>
  );
}

function ResourceDetails({
  id,
  stackSize,
  onSearch,
  forcedExport,
  forcedImport,
  onToggleImport,
  onToggleExport,
  imbalance,
}: {
  id: ResourceId;
  stackSize?: number;
  onSearch: (search: string) => void;
  forcedExport: boolean;
  forcedImport: boolean;
  onToggleImport?: () => void;
  onToggleExport?: () => void;
  imbalance?: number;
}) {
  return (
    <div class="cell-in-play-resource-details">
      <strong>{resourceName(id)}</strong>
      <span>
        {' · '}
        {id}
        {stackSize ? `· stack size ${stackSize}` : ''}
      </span>
      <span class="cell-in-play-resource-searches">
        <button
          type="button"
          class="cell-btn"
          title={`Search for recipes making ${resourceName(id)} (makes:${id})`}
          aria-label={`Search for recipes making ${resourceName(id)}`}
          onClick={() => onSearch(`makes:${id}`)}
        >
          ⌕ makes
        </button>
        <button
          type="button"
          class="cell-btn"
          title={`Search for recipes using ${resourceName(id)} (uses:${id})`}
          aria-label={`Search for recipes using ${resourceName(id)}`}
          onClick={() => onSearch(`uses:${id}`)}
        >
          ⌕ uses
        </button>
        {onToggleImport ? (
          <button
            type="button"
            class="cell-btn"
            aria-pressed={forcedImport}
            title="Supply this resource's shortfall from outside the cell"
            onClick={onToggleImport}
          >
            {forcedImport ? 'Clear explicit import' : 'Import shortfall'}
          </button>
        ) : null}
        {onToggleExport ? (
          <button
            type="button"
            class="cell-btn"
            aria-pressed={forcedExport}
            title="Allow surplus to leave this cell, including waste products"
            onClick={onToggleExport}
          >
            {forcedExport ? 'Clear explicit export' : 'Export surplus'}
          </button>
        ) : null}
      </span>
      {forcedImport ? (
        <p class="cell-export-note">
          Explicit import: shortfall is supplied externally; recipes can still produce this
          resource. Clear explicit import to restore automatic balancing.
        </p>
      ) : forcedExport ? (
        <p class="cell-export-note">
          Explicit export: surplus may leave this cell; recipes can still consume this resource.
          Clear explicit export to restore automatic balancing.
        </p>
      ) : imbalance ? (
        <p class="cell-export-note">
          ⚠ This resource has a {imbalance > 0 ? 'surplus' : 'shortfall'} of{' '}
          {fmt(Math.abs(imbalance))}/s. Review its producers and consumers
          {imbalance > 0 ? ', or export the surplus.' : ', or import the shortfall.'}
        </p>
      ) : null}
    </div>
  );
}

function InPlayConnectionTable({
  outputs,
  inputs,
  inputRate,
  outputRate,
  onRecipeHover,
}: {
  outputs: InternalFlow[];
  inputs: InternalFlow[];
  inputRate: number | undefined;
  outputRate: number | undefined;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  const outputFlows =
    inputRate === undefined
      ? outputs
      : [{ recipe: undefined, label: '[input]' as const, rate: inputRate }, ...outputs];
  const inputFlows =
    outputRate === undefined
      ? inputs
      : [...inputs, { recipe: undefined, label: '[output]' as const, rate: outputRate }];
  const rateDecimalPlaces = decimalPlacesForSignificantFigures(
    Math.max(0, ...outputFlows.map((flow) => flow.rate), ...inputFlows.map((flow) => flow.rate)),
    3,
  );
  const totalConsumption = inputFlows.reduce((total, flow) => total + flow.rate, 0);
  const rowCount = Math.max(outputFlows.length, inputFlows.length, 1);

  return (
    <div
      class="cell-in-play-connection-table"
      style={`--cell-in-play-used-by-heading-row: ${rowCount + 2}`}
    >
      <strong class="cell-in-play-connection-heading cell-in-play-connection-made-by">
        Made by
      </strong>
      <strong class="cell-in-play-connection-heading cell-in-play-connection-used-by">
        Used by
      </strong>
      {Array.from({ length: rowCount }, (_, index) => {
        const output = outputFlows[index];
        const input = inputFlows[index];
        return (
          <div
            class="cell-in-play-connection-row"
            key={index}
            style={`--cell-in-play-made-by-row: ${index + 2}; --cell-in-play-used-by-row: ${rowCount + index + 3}`}
          >
            <ConnectionRecipeFlow flow={output} onRecipeHover={onRecipeHover} />
            <ConnectionRate flow={output} decimalPlaces={rateDecimalPlaces} />
            <ConnectionConsumptionBar flow={input} total={totalConsumption} />
            <ConnectionRate flow={input} decimalPlaces={rateDecimalPlaces} />
            <ConnectionRecipeFlow flow={input} onRecipeHover={onRecipeHover} />
          </div>
        );
      })}
    </div>
  );
}

type ConnectionFlow = { recipe: string | undefined; rate: number; label?: '[input]' | '[output]' };

function ConnectionRecipeFlow({
  flow,
  onRecipeHover,
}: {
  flow: ConnectionFlow | undefined;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  if (!flow) return <span class="cell-in-play-connection-recipe">—</span>;
  if (!flow.recipe) {
    return (
      <span class="cell-in-play-connection-recipe cell-in-play-interface-flow">{flow.label}</span>
    );
  }
  const data = staticData.recipes[flow.recipe];
  return (
    <span
      class="cell-in-play-connection-recipe"
      title={`${fmt(flow.rate)}/s ${recipeName(flow.recipe)}`}
      onMouseEnter={() => onRecipeHover(flow.recipe)}
      onMouseLeave={() => onRecipeHover(undefined)}
    >
      <span
        class="recipe-icon"
        style={data ? recipeIconStyle(flow.recipe, data) : undefined}
        aria-hidden="true"
      />
      <span>{recipeName(flow.recipe)}</span>
    </span>
  );
}

function ConnectionRate({
  flow,
  decimalPlaces,
}: {
  flow: ConnectionFlow | undefined;
  decimalPlaces: number;
}) {
  return (
    <span class="cell-in-play-connection-rate">
      {flow ? `${flow.rate.toFixed(decimalPlaces)}/s` : ''}
    </span>
  );
}

function ConnectionConsumptionBar({
  flow,
  total,
}: {
  flow: ConnectionFlow | undefined;
  total: number;
}) {
  const proportion = flow && total && total > 0 ? Math.min(flow.rate / total, 1) : undefined;
  if (proportion === undefined) {
    return <span class="cell-in-play-connection-consumption-bar" />;
  }
  return (
    <span
      class="cell-in-play-connection-consumption-bar"
      title={`${fmt(proportion * 100)}% of total consumption`}
      aria-label={`${fmt(proportion * 100)}% of total consumption`}
    >
      <span style={`height: ${proportion * 100}%`} aria-hidden="true" />
    </span>
  );
}
