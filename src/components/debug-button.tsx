import './debug-button.css';
import { useMenu } from './menu.ts';
import type { UrlState } from '../url-handler.tsx';

/**
 * A window into `UrlState` for whoever is poking at a hash by hand: the JSON it packs into the URL,
 * formatted and read-only, in a popover off the header. Nothing here writes anything back.
 */
export function DebugButton({ state }: { state: UrlState }) {
  const { open, setOpen, box } = useMenu();

  return (
    <div class="debug-button" ref={box}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show UrlState JSON"
        onClick={() => setOpen(!open)}
      >
        🚧
      </button>
      {open ? (
        <div class="debug-menu" role="dialog" aria-label="UrlState JSON">
          <textarea readOnly value={JSON.stringify(state, null, 2)} rows={20} cols={60} />
        </div>
      ) : null}
    </div>
  );
}
