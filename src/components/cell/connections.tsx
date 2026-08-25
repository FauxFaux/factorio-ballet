import { fmt } from '../../ts.ts';
import type { Solution } from '../../solve.ts';
import type { Belt, ResourceId } from '../../types.ts';
import { resourceIconStyle } from '../icon.tsx';
import { ResourceIcon } from '../resource.tsx';

/** One resource this recipe consumes or produces, at its actual per-second rate. */
type ConnectionFlow = { resource: ResourceId; rate: number };
/** The two directions shown when a recipe row is opened. */
type RecipeConnections = { inputs: ConnectionFlow[]; outputs: ConnectionFlow[] };
const FLOW_EPS = 1e-9;

/**
 * List every material rate for this row. These are deliberately not limited to flows which find a
 * matching row in the cell: the first and last recipes in a chain still need their external input
 * and output rates, including their belt counts.
 */
export function recipeConnections(entry: number, solution: Solution): RecipeConnections {
  const count = solution.counts[entry];
  const rates = solution.rates[entry];
  if (count === undefined || !rates) return { inputs: [], outputs: [] };

  const flows = [...rates]
    .map(([resource, rate]) => ({ resource, rate: rate * count }))
    .filter(({ rate }) => Math.abs(rate) > FLOW_EPS);

  return {
    inputs: flows
      .filter(({ rate }) => rate < 0)
      .map(({ resource, rate }) => ({ resource, rate: -rate }))
      .sort(byRate),
    outputs: flows.filter(({ rate }) => rate > 0).sort(byRate),
  };
}

function byRate(a: ConnectionFlow, b: ConnectionFlow): number {
  return b.rate - a.rate || a.resource.localeCompare(b.resource);
}

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
      <p class="cell-connections cell-connections-pending">
        Connections appear once this row is worked out.
      </p>
    );
  }
  return (
    <div class="cell-connections">
      <ConnectionColumn label="Inputs" flows={connections.inputs} belt={belt} />
      <ConnectionColumn label="Outputs" flows={connections.outputs} belt={belt} />
    </div>
  );
}

function ConnectionColumn({
  label,
  flows,
  belt,
}: {
  label: string;
  flows: ConnectionFlow[];
  belt: Belt;
}) {
  return (
    <section class="cell-connection-column">
      <h4>{label}</h4>
      {flows.length ? (
        <div class="cell-connection-flows">
          {flows.map(({ resource, rate }) => (
            <span class="cell-connection-flow" key={resource} title={`${fmt(rate)}/s ${resource}`}>
              <ResourceIcon id={resource} />
              <span>{fmt(rate)}/s</span>(
              {resource.startsWith('item:') ? (
                <BeltCount rate={rate} belt={belt} />
              ) : (
                <PumpCount rate={rate} />
              )}
              )
            </span>
          ))}
        </div>
      ) : (
        <p>—</p>
      )}
    </section>
  );
}

/** The selected belt's share of an item flow; fluids travel by pipes, so never reach this. */
function BeltCount({ rate, belt }: { rate: number; belt: Belt }) {
  const count = rate / belt.itemsPerSecond;
  const human = belt.human ?? belt.item ?? 'belt';
  return (
    <span
      class="cell-connection-belts"
      title={`${fmtBeltCount(count)} ${human}${count === 1 ? '' : 's'} at ${fmt(belt.itemsPerSecond)}/s each`}
    >
      <span>{fmtBeltCount(count)}</span>
      <span
        class="cell-connection-belt-icon"
        style={resourceIconStyle(`item:${belt.item ?? 'belt-unknown'}`)}
        aria-hidden="true"
      />
    </span>
  );
}

function PumpCount({ rate }: { rate: number }) {
  const pumps = rate / 1200;
  return (
    <span class="cell-connection-pump" title={`${fmt(pumps)} pumps`}>
      <span>{fmt(pumps)}</span>
      <span
        class="cell-connection-belt-icon"
        style={resourceIconStyle(`item:pump`)}
        aria-hidden="true"
      />
    </span>
  );
}

/** A belt count is a planning estimate; one decimal is easier to scan than rate-level precision. */
function fmtBeltCount(count: number): string {
  return count.toFixed(1).replace(/\.0$/, '');
}
