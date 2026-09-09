import './recipe-suggestions.css';
import { PackageDependenciesIcon, PackageDependentsIcon } from '@primer/octicons-react';
import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import type { Cell } from '../../cell.ts';
import { recipeName, resourceName } from '../../data/index.ts';
import { staticData } from '../../data/decode.ts';
import type { ResourceId } from '../../types.ts';
import { CompactRecipe } from '../compact-recipe.tsx';
import { AddToCell } from '../recipe.tsx';
import { ResourceIcon } from '../resource.tsx';
import { isResourceChain, suggestedRecipePaths } from './suggestions.ts';

export function RecipeSuggestions({
  resource,
  search,
  cell,
  progress,
  onAdd,
  inCell,
  onMakeExplicit,
}: {
  resource?: ResourceId;
  search: string;
  cell?: Cell;
  progress: number;
  onAdd?: (recipe: string) => void;
  inCell?: (recipe: string) => boolean;
  onMakeExplicit?: (resource: ResourceId, direction: 'import' | 'export') => void;
}) {
  const suggestions = useMemo(() => {
    const imports = new Set(cell?.imports);
    const exports = new Set(cell?.exports);
    return suggestedRecipePaths(search, cell, resource).filter((suggestion) => {
      if (suggestion.kind === 'input') return !imports.has(suggestion.resource);
      return !exports.has(suggestion.resource);
    });
  }, [search, cell, resource]);
  return (
    <section class="void-path" aria-label="Recipe paths">
      <h2>Top recipe paths</h2>
      {suggestions.length === 0 ? (
        <p class="void-path-hint">
          Search for recipes using a resource to find ways to void it or feed a cell input.
        </p>
      ) : (
        suggestions.map(({ resource, kind, plan, score, scoreFactors }) => {
          const direction = kind === 'input' ? 'import' : 'export';
          return (
            <article key={`${resource}:${kind}:${plan.recipes.join('|')}`} class="void-path-tile">
              <div class="recipe-card void-path-card">
                <div class="void-path-card-head">
                  <h3 class="void-path-for">
                    {kind === 'chain'
                      ? 'Cycle'
                      : kind === 'void'
                        ? 'Void'
                        : kind === 'output'
                          ? 'Use'
                          : 'Make'}{' '}
                    <ResourceIcon id={resource} /> {resourceName(resource)}
                  </h3>
                  <span class="void-path-card-actions">
                    <p class="void-path-score">Score {score.toFixed(1)}</p>
                    {cell && onMakeExplicit ? (
                      <button
                        type="button"
                        class="void-path-explicit"
                        aria-label={`make explicit ${direction}`}
                        title={`Make ${resourceName(resource)} an explicit ${direction}; this prevents suggestions for it from appearing`}
                        onClick={() => onMakeExplicit(resource, direction)}
                      >
                        {direction === 'import' ? (
                          <PackageDependenciesIcon />
                        ) : (
                          <PackageDependentsIcon />
                        )}
                      </button>
                    ) : null}
                    {onAdd ? (
                      <AddToCell
                        onAdd={() => plan.recipes.forEach(onAdd)}
                        inCell={plan.recipes.every((id) => inCell?.(id))}
                      />
                    ) : null}
                  </span>
                </div>
                {(kind === 'chain' || kind === 'input') && isResourceChain(plan) && (
                  <p class="void-path-flow-summary">
                    <ResourceList resources={plan.inputs} label="Needs" />
                    <span class="void-path-flow-arrow" aria-label="makes">
                      ➔
                    </span>
                    <ResourceList resources={[plan.target]} label="Makes" />
                    {plan.outputs.length > 0 && (
                      <>
                        <span class="void-path-also">also</span>
                        <ResourceList resources={plan.outputs} label="Also makes" />
                      </>
                    )}
                  </p>
                )}
                {kind === 'output' && isResourceChain(plan) && (
                  <p class="void-path-flow-summary">
                    <ResourceList resources={[plan.target, ...plan.inputs]} label="Needs" />
                    <span class="void-path-flow-arrow" aria-label="makes">
                      ➔
                    </span>
                    <ResourceList resources={plan.outputs} label="Makes" />
                  </p>
                )}
                <details class="void-path-results">
                  <summary>
                    Show {plan.recipes.length} {plan.recipes.length === 1 ? 'recipe' : 'recipes'}
                  </summary>
                  <p class="void-path-score-factors">
                    Inputs ({formatScoreFactor(scoreFactors.inputs)}) + outputs (
                    {formatScoreFactor(scoreFactors.outputs)}) + buildings (
                    {formatScoreFactor(scoreFactors.buildings)}) + certainty (
                    {formatScoreFactor(scoreFactors.certainty)}) = {formatScoreFactor(score)}
                  </p>
                  <ol
                    class="void-path-steps"
                    aria-label={
                      kind === 'chain' && isResourceChain(plan)
                        ? `Path from ${resource} to ${plan.target}`
                        : kind === 'input' && isResourceChain(plan)
                          ? `Recipe which makes ${resource}`
                          : kind === 'output'
                            ? `Recipe which uses ${resource}`
                            : `Void path for ${resource}`
                    }
                  >
                    {plan.recipes.map((id, step) => {
                      const recipe = staticData.recipes[id];
                      return (
                        <li key={`${id}-${step}`}>
                          {recipe ? (
                            <CompactRecipe
                              match={{ id, recipe, name: recipeName(id) }}
                              progress={progress}
                              onAdd={onAdd && (() => onAdd(id))}
                              inCell={inCell?.(id)}
                            />
                          ) : (
                            recipeName(id)
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </details>
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}

function formatScoreFactor(score: number) {
  return `${score >= 0 ? '+' : ''}${score.toFixed(1)}`;
}

function ResourceList({ resources, label }: { resources: ResourceId[]; label: string }) {
  return (
    <span
      class="void-path-resource-list"
      aria-label={`${label}: ${resources.map(resourceName).join(', ')}`}
    >
      {resources.map((id, index) => (
        <Fragment key={id}>
          {index === 0 ? null : <span class="void-path-resource-separator">+</span>}
          <span class="void-path-resource" title={resourceName(id)}>
            <ResourceIcon id={id} />
          </span>
        </Fragment>
      ))}
    </span>
  );
}
