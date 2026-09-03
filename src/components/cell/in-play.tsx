import './in-play.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CellEntry } from '../../cell.ts';
import { recipeName, resourceName, staticData } from '../../data/index.ts';
import type { Solution } from '../../solve/index.ts';
import { fmt } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import { recipeIconStyle } from '../icon.tsx';
import { ResourceIcon } from '../resource.tsx';
import {
  internalConnections,
  type InternalConnections,
  type InternalFlow,
} from './internal-calc.ts';

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
  const [pinned, setPinned] = useState<ResourceId>();
  const [hovered, setHovered] = useState<ResourceId>();
  const root = useRef<HTMLDivElement>(null);
  const expanded = pinned ?? hovered;

  useEffect(() => {
    if (pinned === undefined) return;

    const dismissOnOutsideClick = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPinned(undefined);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinned(undefined);
    };
    document.addEventListener('pointerdown', dismissOnOutsideClick);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsideClick);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [pinned]);

  const show = (id: ResourceId) => {
    setHovered(id);
    setPinned((current) => (current === id ? current : undefined));
  };

  return (
    <div
      ref={root}
      class="cell-in-play"
      title="Resources in play in this cell"
      onMouseLeave={() => {
        setHovered(undefined);
        onRecipeHover(undefined);
      }}
    >
      in play
      {ids.map((id) => {
        return (
          <InPlayChip
            key={id}
            id={id}
            recipes={entries.map((entry) => entry.recipe)}
            solution={solution}
            input={inputs.has(id)}
            output={outputs.has(id)}
            onRecipeHover={onRecipeHover}
            expanded={expanded === id}
            onMouseEnter={() => show(id)}
            onFocus={() => show(id)}
            onToggle={() => setPinned(id)}
          />
        );
      })}
    </div>
  );
}

function InPlayChip({
  id,
  recipes,
  solution,
  input,
  output,
  onRecipeHover,
  expanded,
  onMouseEnter,
  onFocus,
  onToggle,
}: {
  id: ResourceId;
  recipes: string[];
  solution: Solution;
  input: boolean;
  output: boolean;
  onRecipeHover: (recipe: string | undefined) => void;
  expanded: boolean;
  onMouseEnter: () => void;
  onFocus: () => void;
  onToggle: () => void;
}) {
  const connections = useMemo(
    () => internalConnections(id, recipes, solution),
    [id, recipes, solution],
  );
  const rate = solution.balance.get(id) ?? 0;

  return (
    <div
      class={expanded ? 'cell-in-play-entry is-expanded' : 'cell-in-play-entry'}
      data-in-play-resource={id}
      onMouseEnter={onMouseEnter}
    >
      <button
        type="button"
        class="cell-in-play-chip cell-btn"
        title={`Pin recipes for ${resourceName(id)}`}
        aria-label={`Pin recipes for ${resourceName(id)}`}
        aria-expanded={expanded}
        onFocus={onFocus}
        onClick={onToggle}
      >
        <ResourceIcon id={id} />
        {!input && !output && rate !== 0 ? (
          <span class="cell-leftover">
            {rate > 0 ? '+' : '−'}
            {fmt(Math.abs(rate))}
          </span>
        ) : null}
      </button>
      <InPlayConnectionsView
        id={id}
        connections={connections}
        inputRate={input ? Math.abs(rate) : undefined}
        outputRate={output ? Math.abs(rate) : undefined}
        solved={solution.complete}
        onRecipeHover={onRecipeHover}
      />
    </div>
  );
}

function InPlayConnectionsView({
  id,
  connections,
  inputRate,
  outputRate,
  solved,
  onRecipeHover,
}: {
  id: ResourceId;
  connections: InternalConnections;
  inputRate: number | undefined;
  outputRate: number | undefined;
  solved: boolean;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  const resource = staticData.resources[id];

  if (!solved) {
    return (
      <div class="cell-connections cell-connections-pending">
        <ResourceDetails id={id} stackSize={resource?.stackSize} />
        Recipes appear once the cell is worked out.
      </div>
    );
  }
  return (
    <div class="cell-connections cell-in-play-connections">
      <ResourceDetails id={id} stackSize={resource?.stackSize} />
      <InPlayConnectionColumn
        label="Made by"
        flows={connections.outputs}
        interfaceFlow={inputRate === undefined ? undefined : { label: '[input]', rate: inputRate }}
        onRecipeHover={onRecipeHover}
      />
      <InPlayConnectionColumn
        label="Used by"
        flows={connections.inputs}
        interfaceFlow={
          outputRate === undefined ? undefined : { label: '[output]', rate: outputRate }
        }
        onRecipeHover={onRecipeHover}
      />
    </div>
  );
}

function ResourceDetails({ id, stackSize }: { id: ResourceId; stackSize?: number }) {
  return (
    <div class="cell-in-play-resource-details">
      <strong>{resourceName(id)}</strong>
      <span>
        {' · '}
        {id} · stack size {stackSize ?? 'fluid'}
      </span>
    </div>
  );
}

function InPlayConnectionColumn({
  label,
  flows,
  interfaceFlow,
  onRecipeHover,
}: {
  label: string;
  flows: InternalFlow[];
  interfaceFlow: { label: '[input]' | '[output]'; rate: number } | undefined;
  onRecipeHover: (recipe: string | undefined) => void;
}) {
  return (
    <section class="cell-connection-column">
      <strong>{label}</strong>
      {flows.length || interfaceFlow ? (
        <div class="cell-connection-flows">
          {interfaceFlow ? (
            <span
              class="cell-in-play-connection-flow cell-in-play-interface-flow"
              title={`${fmt(interfaceFlow.rate)}/s ${interfaceFlow.label}`}
            >
              <span>{interfaceFlow.label}</span>
              <span>{fmt(interfaceFlow.rate)}/s</span>
            </span>
          ) : null}
          {flows.map(({ recipe, rate }) => {
            const data = staticData.recipes[recipe];
            return (
              <span
                class="cell-in-play-connection-flow"
                key={recipe}
                title={`${fmt(rate)}/s ${recipeName(recipe)}`}
                onMouseEnter={() => onRecipeHover(recipe)}
                onMouseLeave={() => onRecipeHover(undefined)}
              >
                <span
                  class="recipe-icon"
                  style={data ? recipeIconStyle(recipe, data) : undefined}
                  aria-hidden="true"
                />
                <span>{recipeName(recipe)}</span>
                <span>{fmt(rate)}/s</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p>—</p>
      )}
    </section>
  );
}
