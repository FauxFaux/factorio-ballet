import './kernel-design-button.css';
import gnuIcon from '../assets/heckert-gnu.webp';
import type { State } from '../ts.ts';
import type { UrlState } from '../boot/url-handler.tsx';

/** Opens the standalone workspace for designing a reusable factory kernel. */
export function KernelDesignButton({ uss }: { uss: State<UrlState> }) {
  const [, setUs] = uss;

  return (
    <button
      class="kernel-design-button"
      type="button"
      aria-label="Design kernel"
      title="Design kernel"
      onClick={() =>
        setUs((prev) => ({
          ...prev,
          fa: undefined,
          rb: undefined,
          kd: prev.kd ? undefined : {},
        }))
      }
    >
      <img class="kernel-design-button-icon" src={gnuIcon} alt="" />
    </button>
  );
}
