import './debug-button.css';
import { useMenu } from './menu.ts';
import type { State } from '../ts.ts';
import type { UrlState } from '../url-handler.tsx';

/**
 * A window into `UrlState` for whoever is poking at a hash by hand: the JSON it packs into the URL,
 * formatted in a popover off the header. A complete, valid edit replaces the URL state; incomplete
 * JSON is left in place until it can be parsed.
 */
export function DebugButton({ uss }: { uss: State<UrlState> }) {
  const [state, setState] = uss;
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
          <textarea
            value={JSON.stringify(state, null, 2)}
            rows={20}
            cols={60}
            onInput={(event) => {
              try {
                setState(JSON.parse(event.currentTarget.value) as UrlState);
              } catch {
                // Keep incomplete or malformed JSON available for the next edit.
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
