import { useDataset } from '../../dataset/context.tsx';
import { useState } from 'preact/hooks';
import { decimalPlacesForSignificantFigures, fmt } from '../../ts.ts';
import { recipeName, resourceName } from '../../data/index.ts';
import type { Belt, MachineId, ResourceId } from '../../types.ts';
import { recipeLayouts } from './recipe-layout.ts';
import { MAX_MODULE_HEIGHT } from '../../compute/modules.ts';
import { kernelBuildingFor, type KernelProblem } from '../../compute/kernel-problems.ts';
import { resourceIconStyle } from '../icon.tsx';
import { ResourceIcon } from '../resource.tsx';
import { FuelIcon } from '../fuel-icon.tsx';
import {
  itemRateTotal,
  formatPerMachineRate,
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
  machine,
  inputRates,
  outputRates,
  machineCount,
  progress,
  onSelectResource,
  onDebugProblem = () => {},
}: {
  connections: RecipeConnections;
  solved: boolean;
  /** The selected item belt; fluids deliberately have no belt equivalent here. */
  belt: Belt;
  recipe: string;
  machine: MachineId | undefined;
  inputRates: Map<ResourceId, number> | undefined;
  outputRates: Map<ResourceId, number> | undefined;
  machineCount: number | undefined;
  progress: number;
  onSelectResource: (resource: ResourceId) => void;
  onDebugProblem?: (problem: KernelProblem) => void;
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
        recipeMachineCount={machineCount}
        belt={belt}
        recipe={recipe}
        onSelectResource={onSelectResource}
      />
      <ConnectionSection
        title="Outputs"
        flows={connections.outputs}
        recipeMachineCount={machineCount}
        belt={belt}
        recipe={recipe}
        onSelectResource={onSelectResource}
      />
      <AssemblerDesignSummary
        inputRates={inputRates}
        outputRates={outputRates}
        machineCount={machineCount}
        belt={belt}
        recipe={recipe}
        machine={machine}
        progress={progress}
        onDebugProblem={onDebugProblem}
      />
    </div>
  );
}

function AssemblerDesignSummary({
  inputRates,
  outputRates,
  machineCount,
  belt,
  recipe,
  machine,
  progress,
  onDebugProblem,
}: {
  inputRates: Map<ResourceId, number> | undefined;
  outputRates: Map<ResourceId, number> | undefined;
  machineCount: number | undefined;
  belt: Belt;
  recipe: string;
  machine: MachineId | undefined;
  progress: number;
  onDebugProblem: (problem: KernelProblem) => void;
}) {
  const { data } = useDataset();
  const { problem, options, reason } = recipeLayouts(
    data,
    recipe,
    machine,
    inputRates,
    outputRates,
    machineCount,
    belt,
    progress,
  );

  return (
    <div class="cell-tile-design">
      {options.length === 0 ? (
        <p>Tile design: {reason}</p>
      ) : (
        <div class="cell-layout-options">
          <p>
            {fmt(machineCount!)} buildings required · up to {MAX_MODULE_HEIGHT} tiles per column
          </p>
          <table aria-label="Found kernel layouts">
            <thead>
              <tr>
                <th scope="col">Layout</th>
                <th scope="col">Repeats requested</th>
                <th scope="col">Kernel (tiles)</th>
                <th scope="col">Columns</th>
                <th scope="col">Buildings/column</th>
                <th scope="col">Capacity/column</th>
              </tr>
            </thead>
            <tbody>
              {options.map((option, index) => {
                const { candidate } = option.result;
                const counts = option.columns.map(({ machineCount }) => machineCount);
                const min = Math.min(...counts);
                const max = Math.max(...counts);
                const installed = counts.reduce((sum, count) => sum + count, 0);
                return (
                  <tr key={index}>
                    <th
                      scope="row"
                      title={
                        option.result.optimal
                          ? 'Optimal within this search family'
                          : `Found (${option.result.stopReason})`
                      }
                    >
                      {option.name}
                    </th>
                    <td>×{option.requestedCopies}</td>
                    <td title={`${option.buildingsPerRepeat} buildings per repeat`}>
                      {candidate.width}×{candidate.pitch}
                    </td>
                    <td>{option.columns.length}</td>
                    <td title={`${installed} buildings installed across all columns`}>
                      {min === max ? min : `${min}–${max}`}
                    </td>
                    <td>{option.maxBuildingsPerColumn}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <DebugDesignButton problem={problem} onDebugProblem={onDebugProblem} />
    </div>
  );
}

function DebugDesignButton({
  problem,
  onDebugProblem,
}: {
  problem: KernelProblem;
  onDebugProblem: (problem: KernelProblem) => void;
}) {
  const { data } = useDataset();
  const [complained, setComplained] = useState(false);
  const available = kernelBuildingFor(problem, data) !== undefined;
  return (
    <>
      <button
        type="button"
        class="cell-debug-design"
        onClick={() => {
          if (available) onDebugProblem(problem);
          else setComplained(true);
        }}
      >
        Debug design
      </button>
      {complained && !available && (
        <p role="alert">No matching machine is available in the design debugger for this recipe.</p>
      )}
    </>
  );
}

function ConnectionSection({
  title,
  flows,
  belt,
  recipe,
  recipeMachineCount,
  onSelectResource,
}: {
  title: string;
  flows: ConnectionFlow[];
  belt: Belt;
  recipe: string;
  recipeMachineCount: number | undefined;
  onSelectResource: (resource: ResourceId) => void;
}) {
  return (
    <section class="cell-connection-section">
      <h3 class="cell-connection-section-title">{title}</h3>
      <ConnectionTable
        flows={flows}
        belt={belt}
        recipe={recipe}
        recipeMachineCount={recipeMachineCount}
        onSelectResource={onSelectResource}
      />
    </section>
  );
}

function ConnectionTable({
  flows,
  belt,
  recipe,
  recipeMachineCount,
  onSelectResource,
}: {
  flows: ConnectionFlow[];
  belt: Belt;
  recipe: string;
  recipeMachineCount: number | undefined;
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
          recipeMachineCount={recipeMachineCount}
          onSelectResource={onSelectResource}
          key={flow.resource}
        />
      ))}
    </div>
  );
}

function ConnectionRow({
  flow: { resource, rate, connectedMachineCount, machineCount, connectedRecipes, fuel },
  total,
  belt,
  recipe,
  rateDecimalPlaces,
  transportDecimalPlaces,
  recipeMachineCount,
  onSelectResource,
}: {
  flow: ConnectionFlow;
  total: number;
  belt: Belt;
  recipe: string;
  rateDecimalPlaces: number;
  transportDecimalPlaces: number;
  recipeMachineCount: number | undefined;
  onSelectResource: (resource: ResourceId) => void;
}) {
  const { data } = useDataset();
  const isItem = resource.startsWith('item:');
  const proportion = isItem && total > 0 ? Math.min(rate / total, 1) : 0;
  const share = `${fmt(proportion * 100)}% of total`;
  const fullRate = rate.toFixed(5);
  const perMachine =
    isItem && recipeMachineCount !== undefined && recipeMachineCount > 0
      ? rate / recipeMachineCount / belt.itemsPerSecond
      : undefined;
  return (
    <div class="cell-connection-row">
      {isItem ? (
        <span class="cell-connection-distribution" title={share} aria-label={share}>
          <span style={`height: ${proportion * 100}%`} aria-hidden="true" />
        </span>
      ) : (
        /* Keep this blank distribution cell so fluid rows do not shift. */
        <span aria-hidden="true" />
      )}
      <button
        type="button"
        class="cell-connection-item cell-btn"
        title={`${fullRate}/s ${resourceName(data, resource)} (${resource})`}
        aria-label={`Show recipes for ${resourceName(data, resource)}`}
        onClick={() => onSelectResource(resource)}
      >
        <ResourceIcon id={resource} />
        <span>{resourceName(data, resource)}</span>
        {fuel ? <FuelIcon /> : null}
      </button>
      <ConnectionRate rate={rate} decimalPlaces={rateDecimalPlaces} />
      <MachineRatio
        connectedMachineCount={connectedMachineCount}
        machineCount={machineCount}
        connectedRecipes={connectedRecipes}
        recipe={recipe}
      />
      <span class="cell-connection-transport">
        {perMachine !== undefined && (
          <span
            class="cell-connection-per-machine-rate"
            title={`${perMachine.toFixed(1)} belts per machine (display rounded up)`}
            aria-label={`${formatPerMachineRate(perMachine)} belts per machine, rounded up`}
          >
            {formatPerMachineRate(perMachine)}/m
          </span>
        )}
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
  const { data } = useDataset();
  if (connectedMachineCount === undefined || machineCount === undefined) {
    return <span class="cell-connection-machine-ratio" />;
  }
  const ratio = simplifiedMachineRatio(connectedMachineCount, machineCount);
  const [connectedRatio, machineRatio] = ratio.split(':');
  const connectedRecipe =
    connectedRecipes?.map((v) => recipeName(data, v)).join(', ') ?? 'connected';
  const connectedAssemblers = `${connectedRatio} ${connectedRecipe} assembler${
    connectedRatio === '1' ? '' : 's'
  }`;
  const machinePrefix = machineRatio === '1' ? '' : `${machineRatio} `;
  const machineAssemblers = `${machinePrefix}${recipeName(data, recipe)} assembler${
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
  const { iconMap } = useDataset();
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
        style={resourceIconStyle(iconMap, `item:${belt.item ?? 'belt-unknown'}`)}
        aria-hidden="true"
      />
    </span>
  );
}

function PumpCount({ rate, decimalPlaces }: { rate: number; decimalPlaces: number }) {
  const { iconMap } = useDataset();
  const pumps = rate / 1200;
  return (
    <span class="cell-connection-pump" title={`${pumps.toFixed(2)} pumps`}>
      <TransportValue count={pumps} decimalPlaces={decimalPlaces} />
      <span
        class="cell-connection-belt-icon"
        style={resourceIconStyle(iconMap, `item:pump`)}
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
