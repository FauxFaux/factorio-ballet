import { field, type State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';
import { ProgressSlider } from './components/progress-slider.tsx';
import { RecipeList } from './components/recipe-list.tsx';
import { ResourceList } from './components/resource-list.tsx';

export function App({ uss }: { uss: State<UrlState> }) {
  const recipeSearch = field(uss, 'cs');
  const gp = field(uss, 'gp');
  // the slider is in whole percent, everything downstream in `complexity`'s own 0-to-1 scale
  const progress = gp[0] / 100;

  return (
    <main>
      <header class="app-head">
        <h1>faucalc</h1>
        <ProgressSlider progress={gp} />
      </header>
      <div class="columns">
        <ResourceList
          search={field(uss, 'rs')}
          progress={progress}
          onPick={(id) => recipeSearch[1](`makes:${id}`)}
        />
        <RecipeList search={recipeSearch} progress={progress} />
      </div>
    </main>
  );
}
