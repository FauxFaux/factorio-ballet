import { fmt } from '../../ts.ts';
import { resourceName } from '../../data/index.ts';
import type { Belt } from '../../types.ts';
import { resourceIconStyle } from '../icon.tsx';
import { ResourceIcon } from '../resource.tsx';
import type { ConnectionFlow, RecipeConnections } from './connection-calc.ts';

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
      <ConnectionTable flows={connections.inputs} belt={belt} />
      <ConnectionTable flows={connections.outputs} belt={belt} />
    </div>
  );
}

function ConnectionTable({ flows, belt }: { flows: ConnectionFlow[]; belt: Belt }) {
  const total = flows.reduce((sum, flow) => sum + flow.rate, 0);

  return (
    <div class="cell-connection-table">
      {flows.map((flow) => (
        <ConnectionRow flow={flow} total={total} belt={belt} key={flow.resource} />
      ))}
    </div>
  );
}

function ConnectionRow({
  flow: { resource, rate },
  total,
  belt,
}: {
  flow: ConnectionFlow;
  total: number;
  belt: Belt;
}) {
  const proportion = total > 0 ? Math.min(rate / total, 1) : 0;
  const share = `${fmt(proportion * 100)}% of total`;
  return (
    <div class="cell-connection-row">
      <span class="cell-connection-distribution" title={share} aria-label={share}>
        <span style={`height: ${proportion * 100}%`} aria-hidden="true" />
      </span>
      <span
        class="cell-connection-item"
        title={`${fmt(rate)}/s ${resourceName(resource)} (${resource})`}
      >
        <ResourceIcon id={resource} />
        <span>{resourceName(resource)}</span>
      </span>
      <span class="cell-connection-rate">{fmt(rate)}/s</span>
      <span class="cell-connection-transport">
        {resource.startsWith('item:') ? (
          <BeltCount rate={rate} belt={belt} />
        ) : (
          <PumpCount rate={rate} />
        )}
      </span>
    </div>
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
