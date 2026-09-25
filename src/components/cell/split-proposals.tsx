import './split-proposals.css';
import type { CellEntry } from '../../cell.ts';
import { recipeName } from '../../data/index.ts';
import type { Solution } from '../../solve/index.ts';
import { proposedSplits } from '../../compute/split.ts';
import type { Belt } from '../../types.ts';
import { useMemo } from 'preact/hooks';
import { staticData } from '../../data/decode.ts';

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Compact, read-only partitions derived from the cell's current solved flows. */
export function SplitProposals({
  entries,
  solution,
  belt,
}: {
  entries: CellEntry[];
  solution: Solution;
  belt: Belt;
}) {
  const proposals = useMemo(
    () => proposedSplits(entries, solution, belt),
    [entries, solution, belt],
  );
  if (proposals.length === 0) return null;

  return (
    <section class="cell-split-proposals" aria-label="Proposed splits">
      <h3>Proposed splits</h3>
      {proposals.map((proposal) => (
        <article class="cell-split-proposal" key={proposal.id}>
          <header>
            <strong>{proposal.name}</strong>
            <span>{countLabel(proposal.groups.length, 'group')}</span>
          </header>
          <p>{proposal.reason}</p>
          <ol>
            {proposal.groups.map((group) => (
              <li key={group.id}>
                <span class="cell-split-group-name">{group.name}</span>
                <span class="cell-split-group-size">
                  {countLabel(group.installedMachines, 'machine')} ·{' '}
                  {countLabel(group.entries.length, 'recipe')} · {group.inputs.routes} in /{' '}
                  {group.outputs.routes} out
                </span>
                <span class="cell-split-group-recipes">
                  {group.entries
                    .map((entry) => recipeName(staticData, entries[entry]!.recipe))
                    .join(', ')}
                </span>
              </li>
            ))}
          </ol>
          {proposal.ratios.length > 0 ? (
            <p class="cell-split-ratios">
              Workload ratios:{' '}
              {proposal.ratios
                .map(
                  (ratio) =>
                    `${ratio.producerMachines} ${ratio.producer} : ${ratio.consumerMachines} ${ratio.consumer}`,
                )
                .join('; ')}
            </p>
          ) : null}
        </article>
      ))}
    </section>
  );
}
