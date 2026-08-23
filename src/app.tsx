import './app.css';
import { useMemo } from 'preact/hooks';
import { cellInterface, hasRecipe, newCell, scopeOf, withRecipe } from './cell.ts';
import { field, type State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';
import { CellList } from './components/cell.tsx';
import { ModuleBar } from './components/module.tsx';
import { ProgressSlider } from './components/progress-slider.tsx';
import { RecipeList } from './components/recipe-list.tsx';
import { ResourceList } from './components/resource-list.tsx';

export function App({ uss }: { uss: State<UrlState> }) {
  const [us, setUs] = uss;
  const recipeSearch = field(uss, 'cs');
  const gp = field(uss, 'gp');
  // the slider is in whole percent, everything downstream in `complexity`'s own 0-to-1 scale
  const progress = gp[0] / 100;

  /* The cell being worked on, if any: what a recipe added from the search joins, and what the
   * search's `@in`/`@out` queries mean. Nothing else in the app needs to know which cell that is. */
  const cell = us.cl[us.ci];
  const scope = useMemo(() => (cell ? scopeOf(cellInterface(cell)) : undefined), [cell]);

  /* Both branches write `cl` and `ci` together, which is why this is not two `field` setters: the
   * first recipe added with no cell to put it in makes one, and that one becomes the cell being
   * worked on. */
  const addRecipe = (recipe: string) =>
    setUs((prev) =>
      prev.cl[prev.ci]
        ? {
            ...prev,
            cl: prev.cl.map((c, i) => (i === prev.ci ? withRecipe(c, recipe) : c)),
          }
        : { ...prev, cl: [...prev.cl, newCell(recipe)], ci: prev.cl.length },
    );

  return (
    <main>
      <header class="app-head">
        <h1>faucalc</h1>
        <ProgressSlider progress={gp} />
        <ModuleBar modules={field(uss, 'mo')} progress={progress} />
      </header>
      <CellList
        cells={field(uss, 'cl')}
        active={field(uss, 'ci')}
        progress={progress}
        setSearch={recipeSearch[1]}
      />
      <div class="columns">
        <ResourceList
          search={field(uss, 'rs')}
          progress={progress}
          onPick={(id) => recipeSearch[1](`makes:${id}`)}
        />
        <RecipeList
          search={recipeSearch}
          progress={progress}
          scope={scope}
          onAdd={addRecipe}
          inCell={(recipe) => !!cell && hasRecipe(cell, recipe)}
        />
      </div>
    </main>
  );
}
