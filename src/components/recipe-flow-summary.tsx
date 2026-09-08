import { Fragment } from 'preact';
import { flowTitle, type Flow } from '../flow.ts';
import { ResourceIcon } from './resource.tsx';

/** The folded form: `2.0 [iron] + 8.0 [water] → 4.0 [plate]`, names and amounts in tooltips. */
export function FlowSummary({ ins, outs }: { ins: Flow[]; outs: Flow[] }) {
  return (
    <p class="flow-summary">
      <FlowChips flows={ins} />
      <span class="flow-arrow" aria-label="makes">
        ➔
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
          {i === 0 ? null : <span class="flow-chip-sep">+</span>}
          <span class="flow-chip" title={flowTitle(flow)}>
            <abbr class="flow-chip-rate" title={`${flow.fullRate} per second`}>
              {flow.rate}
            </abbr>
            <span class="flow-chip-icon">
              <ResourceIcon id={flow.resource} />
            </span>
          </span>
        </Fragment>
      ))}
    </>
  );
}
