import './internal.css';
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

/**
 * What the cell makes and consumes itself. `cellInterface` calls a resource internal on set
 * arithmetic alone, so one of these balancing at zero is the cell handling it — and one which does
 * not is a leftover the user is about to have to do something about, which is why it is spelled out
 * here rather than left to the icon.
 */
export function InternalRow({
  ids,
  entries,
  solution,
}: {
  ids: ResourceId[];
  entries: CellEntry[];
  solution: Solution;
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
      class="cell-internal"
      title="Made and used inside this cell"
      onMouseLeave={() => setHovered(undefined)}
    >
      internal
      {ids.map((id) => {
        return (
          <InternalChip
            key={id}
            id={id}
            recipes={entries.map((entry) => entry.recipe)}
            solution={solution}
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

function InternalChip({
  id,
  recipes,
  solution,
  expanded,
  onMouseEnter,
  onFocus,
  onToggle,
}: {
  id: ResourceId;
  recipes: string[];
  solution: Solution;
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
      class={expanded ? 'cell-internal-entry is-expanded' : 'cell-internal-entry'}
      data-internal-resource={id}
      onMouseEnter={onMouseEnter}
    >
      <button
        type="button"
        class="cell-internal-chip cell-btn"
        title={`Pin recipes for ${resourceName(id)}`}
        aria-label={`Pin recipes for ${resourceName(id)}`}
        aria-expanded={expanded}
        onFocus={onFocus}
        onClick={onToggle}
      >
        <ResourceIcon id={id} />
        {rate === 0 ? null : (
          <span class="cell-leftover">
            {rate > 0 ? '+' : '−'}
            {fmt(Math.abs(rate))}
          </span>
        )}
      </button>
      <InternalConnectionsView connections={connections} solved={solution.complete} />
    </div>
  );
}

function InternalConnectionsView({
  connections,
  solved,
}: {
  connections: InternalConnections;
  solved: boolean;
}) {
  if (!solved) {
    return (
      <div class="cell-connections cell-connections-pending">
        Recipes appear once the cell is worked out.
      </div>
    );
  }
  return (
    <div class="cell-connections cell-internal-connections">
      <InternalConnectionColumn label="Made by" flows={connections.outputs} />
      <InternalConnectionColumn label="Used by" flows={connections.inputs} />
    </div>
  );
}

function InternalConnectionColumn({ label, flows }: { label: string; flows: InternalFlow[] }) {
  return (
    <section class="cell-connection-column">
      <strong>{label}</strong>
      {flows.length ? (
        <div class="cell-connection-flows">
          {flows.map(({ recipe, rate }) => {
            const data = staticData.recipes[recipe];
            return (
              <span
                class="cell-internal-connection-flow"
                key={recipe}
                title={`${fmt(rate)}/s ${recipeName(recipe)}`}
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
