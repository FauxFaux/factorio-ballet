import { useState } from 'preact/hooks';
import type { State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';
import { RecipeList } from './components/recipe-list.tsx';
import { ResourceList } from './components/resource-list.tsx';

export function App({ uss: _uss }: { uss: State<UrlState> }) {
  const search = useState('');

  return (
    <main>
      <h1>faucalc</h1>
      <div class="columns">
        <ResourceList onPick={(id) => search[1](`makes:${id}`)} />
        <RecipeList search={search} />
      </div>
    </main>
  );
}
