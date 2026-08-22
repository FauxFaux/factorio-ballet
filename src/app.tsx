import type { State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';
import { ResourceList } from './components/resource-list.tsx';

export function App({ uss: _uss }: { uss: State<UrlState> }) {
  return (
    <main>
      <h1>faucalc</h1>
      <ResourceList />
    </main>
  );
}
