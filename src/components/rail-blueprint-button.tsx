import './rail-blueprint-button.css';
import { useDataset } from '../dataset/context.tsx';
import { iconStyle } from './icon.tsx';
import type { State } from '../ts.ts';
import type { UrlState } from '../boot/url-handler.tsx';

/** Toggles the standalone preview of the standard three-in, two-out rail blueprint. */
export function RailBlueprintButton({ uss }: { uss: State<UrlState> }) {
  const [, setUs] = uss;
  const { iconMap } = useDataset();

  return (
    <button
      class="rail-blueprint-button"
      type="button"
      title="Show rail blueprint"
      onClick={() =>
        setUs((prev) => ({
          ...prev,
          fa: undefined,
          kd: undefined,
          rb: prev.rb ? undefined : [3, 2],
        }))
      }
    >
      <span class="rail-blueprint-button-icon" aria-hidden="true">
        <span style={iconStyle(iconMap, 'item:rail')} />
      </span>
    </button>
  );
}
