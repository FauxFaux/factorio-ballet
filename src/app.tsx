import { field, type State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';
import { RecipeList } from './components/recipe-list.tsx';
import { ResourceList } from './components/resource-list.tsx';

export function App({ uss }: { uss: State<UrlState> }) {
  const recipeSearch = field(uss, 'cs');

  return (
    <main>
      <h1>faucalc</h1>
      <div class="columns">
        <ResourceList search={field(uss, 'rs')} onPick={(id) => recipeSearch[1](`makes:${id}`)} />
        <RecipeList search={recipeSearch} />
      </div>
    </main>
  );
}
