import './import-button.css';
import { useState } from 'preact/hooks';
import { useMenu } from './menu.ts';
import { cellFromConfiguration, decodeUrl } from '../import.ts';
import type { Cell } from '../cell.ts';
import procRsLogo from '../assets/logo-vue.svg';

/** A small inspector for URLs copied from proc-rs or the address bar. */
export function ImportButton({ onAddCell }: { onAddCell: (cell: Cell) => void }) {
  const { open, setOpen, box } = useMenu();
  const [url, setUrl] = useState('');

  let decoded: ReturnType<typeof decodeUrl> = null;
  let error: string | undefined;
  if (url !== '') {
    try {
      decoded = decodeUrl(url);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div class="import-button" ref={box}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="import from proc-rs"
        onClick={() => setOpen(!open)}
      >
        <img src={procRsLogo} alt={'proc-rs'} />
      </button>
      {open ? (
        <div class="import-menu" role="dialog" aria-label="Decode URL">
          <label>
            URL
            <textarea
              autofocus
              value={url}
              onInput={(event) => setUrl(event.currentTarget.value)}
              rows={4}
              cols={60}
              placeholder="Paste a URL or URL fragment"
            />
          </label>
          {error ? <p class="import-error">Could not decode URL: {error}</p> : null}
          {decoded ? (
            <button
              type="button"
              class="import-add-cell"
              disabled={decoded.p.length === 0}
              title="Add active proc-rs processes as a cell"
              onClick={() => {
                onAddCell(cellFromConfiguration(decoded));
                setOpen(false);
              }}
            >
              Add as cell
            </button>
          ) : null}
          <label>
            Decoded JSON
            <textarea readOnly value={JSON.stringify(decoded, null, 2)} rows={20} cols={60} />
          </label>
        </div>
      ) : null}
    </div>
  );
}
