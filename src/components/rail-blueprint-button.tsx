import './rail-blueprint-button.css';
import type { State } from '../ts.ts';
import type { UrlState } from '../url-handler.tsx';

/** Toggles the standalone preview of the standard three-in, two-out rail blueprint. */
export function RailBlueprintButton({ uss }: { uss: State<UrlState> }) {
  const [, setUs] = uss;

  return (
    <button
      class="rail-blueprint-button"
      type="button"
      title="Show rail blueprint"
      onClick={() =>
        setUs((prev) => ({ ...prev, fa: undefined, rb: prev.rb ? undefined : [3, 2] }))
      }
    >
      🚂
    </button>
  );
}
