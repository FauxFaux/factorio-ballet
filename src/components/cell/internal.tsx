import './internal.css';
import { resourceName } from '../../data/index.ts';
import type { Solution } from '../../solve/index.ts';
import { fmt } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import { ResourceIcon } from '../resource.tsx';

/**
 * What the cell makes and consumes itself. `cellInterface` calls a resource internal on set
 * arithmetic alone, so one of these balancing at zero is the cell handling it — and one which does
 * not is a leftover the user is about to have to do something about, which is why it is spelled out
 * here rather than left to the icon.
 */
export function InternalRow({ ids, solution }: { ids: ResourceId[]; solution: Solution }) {
  return (
    <p class="cell-internal" title="Made and used inside this cell">
      internal
      {ids.map((id) => {
        const rate = solution.balance.get(id) ?? 0;
        return (
          <span
            key={id}
            class="cell-internal-chip"
            title={
              rate === 0
                ? `${resourceName(id)}: balanced`
                : `${resourceName(id)}: ${rate > 0 ? 'spare' : 'short'} ${fmt(Math.abs(rate))}/s`
            }
          >
            <ResourceIcon id={id} />
            {rate === 0 ? null : (
              <span class="cell-leftover">
                {rate > 0 ? '+' : '−'}
                {fmt(Math.abs(rate))}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}
