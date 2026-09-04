import './in-play.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
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
  const connectionsElement = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = connectionsElement.current;
    if (!expanded || !element) return;

    const positionWithinViewport = () => {
      element.style.removeProperty('--cell-in-play-connections-offset');
      const { left, right } = element.getBoundingClientRect();
      const edgeInset = 16;
      const offset =
        left < edgeInset
          ? edgeInset - left
          : right > window.innerWidth - edgeInset
            ? window.innerWidth - edgeInset - right
            : 0;
      element.style.setProperty('--cell-in-play-connections-offset', `${offset}px`);
    };

    positionWithinViewport();
    window.addEventListener('resize', positionWithinViewport);
    return () => window.removeEventListener('resize', positionWithinViewport);
  }, [expanded]);

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
        connectionsElement={connectionsElement}
      />
    </div>
  );
}
