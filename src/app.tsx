import type { State } from './ts.ts';
import type { UrlState } from './url-handler.tsx';

export function App({ uss: _uss }: { uss: State<UrlState> }) {
  return <p>yo</p>;
}
