import './recipe.css';
import './compact-recipe.css';
import { defaultMachine, machinesFor } from '../data/machines.ts';
import { recipeFlows, speedOf } from '../flow.ts';
import type { RecipeMatch } from '../search.ts';
import { recipeIconStyle } from './icon.tsx';
import { FlowSummary } from './recipe-flow-summary.tsx';
import { AddToCell } from './recipe.tsx';

/** A folded recipe summary, optionally with the usual control to add it to the current cell. */
export function CompactRecipe({
  match: { id, recipe, name },
  progress,
  onAdd,
  inCell = false,
}: {
  match: RecipeMatch;
  /** Overall game progress, used to choose the machine whose rates are shown. */
  progress: number;
  /** Put this recipe, using the automatic machine choice, in the cell being worked on. */
  onAdd?: () => void;
  /** Whether that cell already runs it. */
  inCell?: boolean;
}) {
  const machines = machinesFor(recipe);
  const machine = defaultMachine(machines, progress)?.id;
  const speed = speedOf(machines, machine);
  const { ins, outs } = recipeFlows(recipe, machines, speed);

  return (
    <div class={`recipe-card compact-recipe${recipe.synthetic ? ' is-synthetic' : ''}`}>
      <div class="recipe-head">
        <span class="compact-recipe-icon" aria-hidden="true">
          <span
            class="recipe-icon compact-recipe-icon-sprite"
            style={recipeIconStyle(id, recipe)}
          />
        </span>
        <span class="recipe-name" title={id}>
          {name}
        </span>
        <span class="recipe-duration">{(recipe.duration / speed).toFixed(2)}s</span>
        {onAdd ? <AddToCell onAdd={onAdd} inCell={inCell} /> : null}
      </div>
      <FlowSummary ins={ins} outs={outs} />
    </div>
  );
}
