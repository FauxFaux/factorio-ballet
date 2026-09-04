import './in-play.css';
import { useMemo, useState } from 'preact/hooks';
import type { CellEntry } from '../../cell.ts';
import { resourceName } from '../../data/index.ts';
import type { Solution } from '../../solve/index.ts';
import { fmt } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import { ResourceIcon } from '../resource.tsx';
import { internalConnections } from './internal-calc.ts';
import { InPlayConnectionsView } from './in-play-connections.tsx';

/** Every resource a recipe in this cell consumes or produces, including its open edges. */
export function InPlayRow({
  ids,
  entries,
  solution,
  inputs,
  outputs,
  onRecipeHover,
}: {
  ids: ResourceId[];
  entries: CellEntry[];
  solution: Solution;
  inputs: ReadonlySet<ResourceId>;
  outputs: ReadonlySet<ResourceId>;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  const [selected, setSelected] = useState<ResourceId>();

  const select = (id: ResourceId) => {
    setSelected((current) => (current === id ? undefined : id));
    onRecipeHover(undefined);
  };

  return (
    <div class="cell-in-play" title="Resources in play in this cell">
      {ids.map((id) => {
        return (
          <InPlayChip
            key={id}
            id={id}
            solution={solution}
            input={inputs.has(id)}
            output={outputs.has(id)}
            selected={selected === id}
            onClick={() => select(id)}
          />
        );
      })}
      {selected ? (
        <InPlayDetails
          id={selected}
          recipes={entries.map((entry) => entry.recipe)}
          solution={solution}
          input={inputs.has(selected)}
          output={outputs.has(selected)}
          onRecipeHover={onRecipeHover}
        />
      ) : null}
    </div>
  );
}

function InPlayChip({
  id,
  solution,
  input,
  output,
  selected,
  onClick,
}: {
  id: ResourceId;
  solution: Solution;
  input: boolean;
  output: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const rate = solution.balance.get(id) ?? 0;

  return (
    <div class="cell-in-play-entry" data-in-play-resource={id}>
      <button
        type="button"
        class={selected ? 'cell-in-play-chip cell-btn is-selected' : 'cell-in-play-chip cell-btn'}
        title={`${selected ? 'Hide' : 'Show'} recipes for ${resourceName(id)}`}
        aria-label={`${selected ? 'Hide' : 'Show'} recipes for ${resourceName(id)}`}
        aria-pressed={selected}
        onClick={onClick}
      >
        <ResourceIcon id={id} />
        {!input && !output && rate !== 0 ? (
          <span class="cell-leftover">
            {rate > 0 ? '+' : '−'}
            {fmt(Math.abs(rate))}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function InPlayDetails({
  id,
  recipes,
  solution,
  input,
  output,
  onRecipeHover,
}: {
  id: ResourceId;
  recipes: string[];
  solution: Solution;
  input: boolean;
  output: boolean;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  const connections = useMemo(
    () => internalConnections(id, recipes, solution),
    [id, recipes, solution],
  );
  const rate = solution.balance.get(id) ?? 0;

  return (
    <InPlayConnectionsView
      id={id}
      connections={connections}
      inputRate={input ? Math.abs(rate) : undefined}
      outputRate={output ? Math.abs(rate) : undefined}
      solved={solution.complete}
      onRecipeHover={onRecipeHover}
    />
  );
}
