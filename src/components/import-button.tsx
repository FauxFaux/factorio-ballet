import './import-button.css';
import { useEffect, useState } from 'preact/hooks';
import { useMenu } from './menu.ts';
import type { DehydratedGraphConfiguration, ImportedConfiguration } from '../import.ts';
import type { Cell } from '../cell.ts';
import procRsLogo from '../assets/logo-vue.svg';

/** A small inspector for URLs copied from proc-rs or FactorioLab. */
export function ImportButton({ onAddCell }: { onAddCell: (cell: Cell) => void }) {
  const { open, setOpen, box } = useMenu();
  const [url, setUrl] = useState('');
  const [importModule, setImportModule] = useState<typeof import('../import.ts')>();
  const [decoded, setDecoded] = useState<ImportedConfiguration | null>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    if (url === '') {
      setDecoded(undefined);
      setError(undefined);
      return;
    }

    setDecoded(undefined);
    setError(undefined);
    void import('../import.ts')
      .then((module) => {
        if (cancelled) return;
        setImportModule(module);
        try {
          setDecoded(module.decodeImportUrl(url));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div class="import-button" ref={box}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Import from proc-rs or FactorioLab"
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
          {decoded && !('source' in decoded) ? (
            <button
              type="button"
              class="import-add-cell"
              disabled={decoded.p.length === 0}
              title="Add active proc-rs processes as a cell"
              onClick={() => {
                if (importModule === undefined) return;
                onAddCell(
                  importModule.cellFromConfiguration(decoded as DehydratedGraphConfiguration),
                );
                setOpen(false);
              }}
            >
              Add as cell
            </button>
          ) : null}
          {decoded !== undefined ? (
            <label>
              Decoded JSON
              <textarea readOnly value={JSON.stringify(decoded, null, 2)} rows={20} cols={60} />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
