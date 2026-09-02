import './app.css';
import { useMemo } from 'preact/hooks';
import { cellInterface, hasRecipe, newCell, scopeOf, withRecipe } from './cell.ts';
import { resolveChosen } from './data.ts';
import { field, type State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';
import { CellList } from './components/cell-list.tsx';
import { DebugButton } from './components/debug-button.tsx';
import { ImportButton } from './components/import-button.tsx';
import { ModuleBar } from './components/module.tsx';
import { ProgressSlider } from './components/progress-slider.tsx';
import { RecipeList } from './components/recipe-list.tsx';
import { ResourceList } from './components/resource-list.tsx';
import { UnlitFilter } from './components/unlit-module-icon.tsx';

export function App({ uss }: { uss: State<UrlState> }) {
  const [us, setUs] = uss;
  const recipeSearch = field(uss, 'cs');
  const gp = field(uss, 'gp');
  // the slider is in whole percent, everything downstream in `complexity`'s own 0-to-1 scale
  const progress = gp[0] / 100;
  /* Which modules the cells mean by "a speed module" and "a productivity module", and which beacon
   * the speed ones overflow into, plus the belt reserved for future throughput checks. Resolved here
   * so the cells are handed the modules and beacon rather than a preference to re-resolve — and
   * memoised, because a cell's solution is memoised against this. */
  const chosen = useMemo(
    () => resolveChosen(us.mo, us.be, us.bt, progress),
    [us.mo, us.be, us.bt, progress],
  );

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
      {/* a `filter: url()` is looked up by id across the whole document, and both the header's
          pickers and the cells' speed boxes wear this one, so it is defined once here */}
      <UnlitFilter />
      <header class="app-head">
        <h1>faucalc</h1>
        <ProgressSlider progress={gp} />
        <ModuleBar
          modules={field(uss, 'mo')}
          beacon={field(uss, 'be')}
          belt={field(uss, 'bt')}
          progress={progress}
        />
        <ImportButton />
        <DebugButton state={us} />
      </header>
      <CellList
        cells={field(uss, 'cl')}
        active={field(uss, 'ci')}
        progress={progress}
        chosen={chosen}
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
