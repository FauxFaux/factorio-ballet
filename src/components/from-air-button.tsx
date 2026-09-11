import './from-air-button.css';
import type { State } from '../ts.ts';
import type { UrlState } from '../url-handler.tsx';

/** Opens the standalone planner for processes that start from air. */
export function FromAirButton({ uss }: { uss: State<UrlState> }) {
  const [, setUs] = uss;

  return (
    <button
      class="from-air-button"
      type="button"
      title="Plan from air"
      onClick={() => setUs((prev) => ({ ...prev, fa: true, rb: undefined }))}
    >
      💨
    </button>
  );
}
