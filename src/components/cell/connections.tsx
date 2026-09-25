import { decimalPlacesForSignificantFigures, fmt } from '../../ts.ts';
import { recipeName, resourceName } from '../../data/index.ts';
import type { Belt, MachineId, ResourceId } from '../../types.ts';
import { solveKernelTileDesign } from '../../compute/tile-design/kernel-result.ts';
import { MAX_MODULE_HEIGHT, modulesForTile, recipeKernelProblem } from '../../compute/modules.ts';
import type { KernelProblem } from '../../compute/kernel-problems.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../../data/inserter-throughput.ts';
import { resourceIconStyle } from '../icon.tsx';
import { ResourceIcon } from '../resource.tsx';
import { designBounds } from '../design/design-preview.tsx';
import {
  itemRateTotal,
  simplifiedMachineRatio,
  type ConnectionFlow,
  type RecipeConnections,
} from './connection-calc.ts';
import { staticData } from '../../data/decode.ts';

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
  // Solution input and output rates already describe one machine.
  const problem = recipeKernelProblem(
    staticData,
    recipe,
    machine,
    inputRates ?? new Map(),
    outputRates ?? new Map(),
  );
  const throughput = {
    beltItemsPerSecond: belt.itemsPerSecond,
    inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, belt),
    longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, belt, 2),
  };
  const result = solveKernelTileDesign(problem, throughput);
  if ('success' in result) {
    return (
      <div class="cell-tile-design">
        <p>Tile design: {result.message}</p>
        <DebugDesignButton problem={problem} onDebugProblem={onDebugProblem} />
      </div>
    );
  }
  if (result.status !== 'found') {
    return (
      <div class="cell-tile-design">
        <p>Tile design: {result.reason}</p>
        <DebugDesignButton problem={problem} onDebugProblem={onDebugProblem} />
      </div>
    );
  }

  const column = result.candidate.column;
  const bounds = designBounds(column.entities)!;
  const maxHeight = Math.min(
    result.validation.supportedCopies,
    Math.floor(MAX_MODULE_HEIGHT / result.candidate.pitch),
  );
  if (maxHeight < 1 || machineCount === undefined) {
    return (
      <div class="cell-tile-design">
        <p>Tile design: no solution</p>
        <DebugDesignButton problem={problem} onDebugProblem={onDebugProblem} />
      </div>
    );
  }
  const moduleCount = modulesForTile(
    recipe,
    machineCount,
    problem,
    result.candidate,
    maxHeight,
  ).length;

  return (
    <div class="cell-tile-design">
      <dl aria-label="Tile design">
        <div>
          <dt>Kernel size</dt>
          <dd>
            {bounds.maxX - bounds.minX}×{bounds.maxY - bounds.minY} tiles
          </dd>
        </div>
        <div>
          <dt>Max column height</dt>
          <dd>×{maxHeight}</dd>
        </div>
        <div>
          <dt>Columns/modules needed</dt>
          <dd>×{moduleCount}</dd>
        </div>
      </dl>
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
  return (
    <button type="button" class="cell-debug-design" onClick={() => onDebugProblem(problem)}>
      Debug design
    </button>
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
        title={`${fullRate}/s ${resourceName(staticData, resource)} (${resource})`}
        aria-label={`Show recipes for ${resourceName(staticData, resource)}`}
        onClick={() => onSelectResource(resource)}
      >
        <ResourceIcon id={resource} />
        <span>{resourceName(staticData, resource)}</span>
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
  const connectedRecipe =
    connectedRecipes?.map((v) => recipeName(staticData, v)).join(', ') ?? 'connected';
  const connectedAssemblers = `${connectedRatio} ${connectedRecipe} assembler${
    connectedRatio === '1' ? '' : 's'
  }`;
  const machinePrefix = machineRatio === '1' ? '' : `${machineRatio} `;
  const machineAssemblers = `${machinePrefix}${recipeName(staticData, recipe)} assembler${
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
