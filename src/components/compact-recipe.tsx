import './recipe.css';
import './compact-recipe.css';
import { defaultMachine, machinesFor } from '../data/machines.ts';
import { recipeFlows, speedOf } from '../flow.ts';
import type { RecipeMatch } from '../search.ts';
import { recipeIconStyle } from './icon.tsx';
import { FlowSummary } from './recipe-flow-summary.tsx';

/** A read-only folded recipe summary for contexts where recipe selection is unavailable. */
export function CompactRecipe({
  match: { id, recipe, name },
  progress,
}: {
  match: RecipeMatch;
  /** Overall game progress, used to choose the machine whose rates are shown. */
  progress: number;
}) {
  const machines = machinesFor(recipe);
  const machine = defaultMachine(machines, progress)?.id;
  const speed = speedOf(machines, machine);
  const { ins, outs } = recipeFlows(recipe, machines, speed);

  return (
    <div class={`recipe-card compact-recipe${recipe.synthetic ? ' is-synthetic' : ''}`}>
      <div class="recipe-head">
        <span class="recipe-icon" style={recipeIconStyle(id, recipe)} aria-hidden="true" />
        <span class="recipe-name" title={id}>
          {name}
        </span>
        <span class="recipe-duration">{(recipe.duration / speed).toFixed(2)}s</span>
      </div>
      <FlowSummary ins={ins} outs={outs} />
    </div>
  );
}
