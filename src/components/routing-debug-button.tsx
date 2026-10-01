import './routing-debug-button.css';
import { useDataset } from '../dataset/context.tsx';
import { iconStyle } from './icon.tsx';
import type { State } from '../ts.ts';
import type { UrlState } from '../boot/url-handler.tsx';

/** Toggles the standalone routing debugger. */
export function RoutingDebugButton({ uss }: { uss: State<UrlState> }) {
  const [, setUs] = uss;
  const { iconMap } = useDataset();

  return (
    <button
      class="routing-debug-button"
      type="button"
      aria-label="Debug routing"
      title="Debug routing"
      onClick={() =>
        setUs((prev) => ({
          ...prev,
          fa: undefined,
          rb: undefined,
          kd: undefined,
          rd: prev.rd ? undefined : {},
        }))
      }
    >
      <span class="routing-debug-button-icon" aria-hidden="true">
        <span style={iconStyle(iconMap, 'item:underground-belt')} />
      </span>
    </button>
  );
}
