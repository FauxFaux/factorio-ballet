import './in-play.css';
import { useMemo } from 'preact/hooks';
import type { CellEntry } from '../../cell.ts';
import { resourceName } from '../../data/index.ts';
import { boundarySuggestionText, type Solution } from '../../solve/index.ts';
import { fmt } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import { ResourceIcon } from '../resource.tsx';
import { internalConnections } from './internal-calc.ts';
import { InPlayConnectionsView, ResourceActions } from './in-play-connections.tsx';
import { WarnIcon } from './notes.tsx';

/** Every resource a recipe in this cell consumes or produces, including its open edges. */
export function InPlayRow({
  ids,
  entries,
  solution,
  inputs,
  outputs,
  exports = [],
  imports = [],
  vertical,
  onToggleImport,
  onToggleExport,
  onRecipeHover,
  onSearch,
  onToggleRecipe,
  onInterfaceHover,
  selected,
  onSelect,
}: {
  ids: ResourceId[];
  entries: CellEntry[];
  solution: Solution;
  inputs: ReadonlySet<ResourceId>;
  outputs: ReadonlySet<ResourceId>;
  exports?: ResourceId[];
  imports?: ResourceId[];
  vertical: boolean;
  onToggleImport?: (id: ResourceId) => void;
  onToggleExport?: (id: ResourceId) => void;
  onRecipeHover: (recipe: string | undefined) => void;
  onSearch: (search: string) => void;
  onToggleRecipe: (recipe: string) => void;
  onInterfaceHover: (resource: ResourceId | undefined) => void;
  selected?: ResourceId;
  onSelect: (id: ResourceId | undefined) => void;
}) {
  const select = (id: ResourceId) => {
    onSelect(selected === id ? undefined : id);
    onRecipeHover(undefined);
  };

  const applyBoundarySuggestion = (
    suggestion: NonNullable<Solution['boundarySuggestions']>[number],
  ) => {
    onSelect(suggestion.resource);
    onRecipeHover(undefined);
    if (suggestion.direction === 'import') onToggleImport?.(suggestion.resource);
    else onToggleExport?.(suggestion.resource);
  };
  return (
    <div
      class={vertical ? 'cell-in-play is-vertical' : 'cell-in-play'}
      title="Resources in play in this cell"
    >
      {ids.map((id) => {
        return (
          <div
            class={vertical ? 'cell-in-play-entry is-vertical' : 'cell-in-play-entry'}
            data-in-play-resource={id}
            key={id}
          >
            <InPlayChip
              id={id}
              solution={solution}
              input={inputs.has(id)}
              output={outputs.has(id)}
              selected={selected === id}
              vertical={vertical}
              onClick={() => select(id)}
            />
            {vertical ? (
              <ResourceActions
                id={id}
                onSearch={onSearch}
                forcedExport={exports.includes(id)}
                forcedImport={imports.includes(id)}
                onToggleImport={onToggleImport ? () => onToggleImport(id) : undefined}
                onToggleExport={onToggleExport ? () => onToggleExport(id) : undefined}
              />
            ) : null}
            {vertical && selected === id ? (
              <InPlayDetails
                id={id}
                recipes={entries.map((entry) => entry.recipe)}
                solution={solution}
                input={inputs.has(id)}
                output={outputs.has(id)}
                forcedExport={exports.includes(id)}
                forcedImport={imports.includes(id)}
                onToggleImport={onToggleImport ? () => onToggleImport(id) : undefined}
                onToggleExport={onToggleExport ? () => onToggleExport(id) : undefined}
                onRecipeHover={onRecipeHover}
                onSearch={onSearch}
                onToggleRecipe={onToggleRecipe}
                onInterfaceHover={onInterfaceHover}
                showActions={false}
              />
            ) : null}
          </div>
        );
      })}
      {solution.boundarySuggestions?.length ? (
        <div class="cell-in-play-resource-details">
          <p class="cell-export-note">
            <WarnIcon /> The cell is not internally consistent. A resource can appear balanced in
            one place while forcing a shortfall elsewhere.
            <br /> Verified fixes:
            {solution.boundarySuggestions.map((suggestion) => (
              <button
                key={suggestion.resource}
                type="button"
                class="cell-btn cell-in-play-resource-action"
                title={boundarySuggestionText(suggestion)}
                onClick={() => applyBoundarySuggestion(suggestion)}
              >
                <ResourceIcon id={suggestion.resource} />
                {suggestion.direction} {resourceName(suggestion.resource)}
              </button>
            ))}
          </p>
        </div>
      ) : null}
      {selected && !vertical ? (
        <InPlayDetails
          id={selected}
          recipes={entries.map((entry) => entry.recipe)}
          solution={solution}
          input={inputs.has(selected)}
          output={outputs.has(selected)}
          forcedExport={exports.includes(selected)}
          forcedImport={imports.includes(selected)}
          onToggleImport={onToggleImport ? () => onToggleImport(selected) : undefined}
          onToggleExport={onToggleExport ? () => onToggleExport(selected) : undefined}
          onRecipeHover={onRecipeHover}
          onSearch={onSearch}
          onToggleRecipe={onToggleRecipe}
          onInterfaceHover={onInterfaceHover}
          showActions
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
  vertical,
  onClick,
}: {
  id: ResourceId;
  solution: Solution;
  input: boolean;
  output: boolean;
  selected: boolean;
  vertical: boolean;
  onClick: () => void;
}) {
  const rate = solution.balance.get(id) ?? 0;
  const suggestion = solution.boundarySuggestions?.find((candidate) => candidate.resource === id);
  const unbalanced = !input && !output && rate !== 0;
  const imbalanceTitle =
    `${resourceName(id)} is unbalanced. ` +
    'Open its details to review supply and consumption or allow ' +
    `${rate > 0 ? 'surplus export' : 'shortfall import'}.`;

  return (
    <button
      type="button"
      class={selected ? 'cell-in-play-chip cell-btn is-selected' : 'cell-in-play-chip cell-btn'}
      title={`${selected ? 'Hide' : 'Show'} recipes for ${resourceName(id)}`}
      aria-label={`${selected ? 'Hide' : 'Show'} recipes for ${resourceName(id)}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {vertical ? <span aria-hidden="true">{selected ? '▾' : '▸'}</span> : null}
      <ResourceIcon id={id} />
      {vertical ? <span class="cell-in-play-name">{resourceName(id)}</span> : null}
      {unbalanced || suggestion ? (
        <span
          class="cell-leftover"
          title={suggestion ? boundarySuggestionText(suggestion) : imbalanceTitle}
        >
          <WarnIcon
            label={
              suggestion ? `Review ${suggestion.direction} for ${resourceName(id)}` : undefined
            }
          />
          {unbalanced ? `${rate > 0 ? '+' : '−'}${fmt(Math.abs(rate))}` : null}
        </span>
      ) : null}
    </button>
  );
}

function InPlayDetails({
  id,
  recipes,
  solution,
  input,
  output,
  forcedExport,
  forcedImport,
  onToggleImport,
  onToggleExport,
  onRecipeHover,
  onSearch,
  onToggleRecipe,
  onInterfaceHover,
  showActions,
}: {
  id: ResourceId;
  recipes: string[];
  solution: Solution;
  input: boolean;
  output: boolean;
  forcedExport: boolean;
  forcedImport: boolean;
  onToggleImport?: () => void;
  onToggleExport?: () => void;
  onRecipeHover: (recipe: string | undefined) => void;
  onSearch: (search: string) => void;
  onToggleRecipe: (recipe: string) => void;
  onInterfaceHover: (resource: ResourceId | undefined) => void;
  showActions: boolean;
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
      inputRate={input ? Math.max(0, -rate) : undefined}
      outputRate={output ? Math.max(0, rate) : undefined}
      forcedExport={forcedExport}
      forcedImport={forcedImport}
      onToggleImport={onToggleImport}
      onToggleExport={onToggleExport}
      imbalance={!input && !output ? rate : undefined}
      suggestion={solution.boundarySuggestions?.find((candidate) => candidate.resource === id)}
      solved={solution.complete}
      onRecipeHover={onRecipeHover}
      onSearch={onSearch}
      onToggleRecipe={onToggleRecipe}
      onInterfaceHover={onInterfaceHover}
      showActions={showActions}
    />
  );
}
