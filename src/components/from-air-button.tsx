import './from-air-button.css';
import { useDataset } from '../dataset/context.tsx';
import { iconStyle } from './icon.tsx';
import type { State } from '../ts.ts';
import type { UrlState } from '../boot/url-handler.tsx';

/** Opens the standalone planner for processes that start from air. */
export function FromAirButton({ uss }: { uss: State<UrlState> }) {
  const [, setUs] = uss;
  const { iconMap } = useDataset();

  return (
    <button
      class="from-air-button"
      type="button"
      title="Plan from air"
      onClick={() => setUs((prev) => ({ ...prev, fa: true, kd: undefined, rb: undefined }))}
    >
      <span class="from-air-button-icon" aria-hidden="true">
        <span style={iconStyle(iconMap, 'fluid:angels-gas-compressed-air', 'fluid:water')} />
      </span>
    </button>
  );
}
