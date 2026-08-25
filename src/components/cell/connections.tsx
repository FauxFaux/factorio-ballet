import type { CellEntry } from '../../cell.ts';
import { recipeName } from '../../data.ts';
import { fmt } from '../../ts.ts';
import type { Solution } from '../../solve.ts';
import type { ResourceId } from '../../types.ts';
import { ResourceIcon } from '../resource.tsx';

/** A recipe on the other end of one or more of this row's in-cell flows. */
type RecipeConnection = { entry: number; percent: number; flows: ConnectionFlow[] };
/** One resource's share of a connection, at its actual per-second rate. */
type ConnectionFlow = { resource: ResourceId; rate: number };
/** The two directions shown when a recipe row is opened. */
type RecipeConnections = { inputs: RecipeConnection[]; outputs: RecipeConnection[] };
const FLOW_EPS = 1e-9;

/**
 * Split each of this row's resources between the other rows which can be on its other end. A
 * cell only records net rates, not a literal belt-by-belt routing, so when more than one row can
 * make or use an item the split is proportional to their current rates. Resources are weighted by
 * this row's rate, then the results are folded by recipe: one concise answer per neighbouring row.
 */
export function recipeConnections(entry: number, solution: Solution): RecipeConnections {
  return {
    inputs: connectionsFor(entry, solution, 'input'),
    outputs: connectionsFor(entry, solution, 'output'),
  };
}

function connectionsFor(
  entry: number,
  solution: Solution,
  direction: 'input' | 'output',
): RecipeConnection[] {
  const count = solution.counts[entry];
  const rates = solution.rates[entry];
  if (count === undefined || !rates) return [];

  const portions = new Map<number, number>();
  const flows = new Map<number, Map<ResourceId, number>>();
  let total = 0;
  for (const [resource, rate] of rates) {
    const own = rate * count;
    const wantsOther = direction === 'input' ? own < -FLOW_EPS : own > FLOW_EPS;
    if (!wantsOther) continue;

    const matches = solution.rates.flatMap((otherRates, other) => {
      if (other === entry || solution.counts[other] === undefined) return [];
      const otherFlow = (otherRates.get(resource) ?? 0) * solution.counts[other]!;
      const opposite = direction === 'input' ? otherFlow > FLOW_EPS : otherFlow < -FLOW_EPS;
      return opposite ? [{ entry: other, flow: Math.abs(otherFlow) }] : [];
    });
    const available = matches.reduce((sum, match) => sum + match.flow, 0);
    if (!(available > FLOW_EPS)) continue;

    const weight = Math.abs(own);
    total += weight;
    for (const match of matches) {
      const portion = (weight * match.flow) / available;
      portions.set(match.entry, (portions.get(match.entry) ?? 0) + portion);
      const byResource = flows.get(match.entry) ?? new Map<ResourceId, number>();
      byResource.set(resource, (byResource.get(resource) ?? 0) + portion);
      flows.set(match.entry, byResource);
    }
  }

  return [...portions]
    .map(([other, portion]) => ({
      entry: other,
      percent: (portion / total) * 100,
      flows: [...(flows.get(other) ?? [])]
        .map(([resource, rate]) => ({ resource, rate }))
        .sort((a, b) => b.rate - a.rate || a.resource.localeCompare(b.resource)),
    }))
    .sort((a, b) => b.percent - a.percent || a.entry - b.entry);
}

/** The two compact columns below an expanded recipe row. */
export function RecipeConnections({
  connections,
  entries,
  solved,
}: {
  connections: RecipeConnections;
  entries: CellEntry[];
  solved: boolean;
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
      <ConnectionColumn label="Inputs from" connections={connections.inputs} entries={entries} />
      <ConnectionColumn label="Outputs to" connections={connections.outputs} entries={entries} />
    </div>
  );
}

function ConnectionColumn({
  label,
  connections,
  entries,
}: {
  label: string;
  connections: RecipeConnection[];
  entries: CellEntry[];
}) {
  return (
    <section class="cell-connection-column">
      <h4>{label}</h4>
      {connections.length ? (
        connections.map(({ entry, percent, flows }) => (
          <div class="cell-connection" key={entry}>
            <span class="cell-connection-details">
              <span class="cell-connection-name" title={entries[entry]?.recipe}>
                {recipeName(entries[entry]?.recipe ?? '?')}
              </span>
              <span class="cell-connection-flows">
                {flows.map(({ resource, rate }) => (
                  <span
                    class="cell-connection-flow"
                    key={resource}
                    title={`${fmt(rate)}/s ${resource}`}
                  >
                    <ResourceIcon id={resource} />
                    <span>{fmt(rate)}/s</span>
                  </span>
                ))}
              </span>
            </span>
            <span>{fmt(percent)}%</span>
          </div>
        ))
      ) : (
        <p>—</p>
      )}
    </section>
  );
}
