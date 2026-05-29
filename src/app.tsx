import type { State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';
import { ItemList } from './components/item-list.tsx';

export function App({ uss: _uss }: { uss: State<UrlState> }) {
  return (
    <main>
      <h1>faucalc</h1>
      <ItemList />
    </main>
  );
}
