import { useEffect, useState } from 'preact/hooks';
import { debounce } from './ts.ts';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { App } from './app.tsx';
import { CrashHandler } from './crash-handler.tsx';

export interface UrlState {
  v: 1;
  /** the ResourceList search box */
  rs: string;
  /** the RecipeList search box */
  cs: string;
}

const defaultUs: UrlState = { v: 1, rs: '', cs: '' };

const HASH_VERSION = 'h';

const setHash = debounce((v: UrlState) => {
  window.location.hash = packUs(v);
}, 50);

type ParseResult =
  | { kind: 'ok'; us: UrlState }
  | { kind: 'version-error' }
  | { kind: 'unpack-error'; hash: string; message: string };

function parseHash(hash: string): ParseResult {
  if (hash.length <= 1) return { kind: 'ok', us: defaultUs };
  if (!hash.slice(1).startsWith(HASH_VERSION)) return { kind: 'version-error' };
  try {
    return { kind: 'ok', us: unpackUs(hash) };
  } catch (e) {
    return {
      kind: 'unpack-error',
      hash,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export function UrlHandler() {
  const [initResult] = useState(() => parseHash(window.location.hash));
  const [unpackError, setUnpackError] = useState<{ hash: string; message: string } | undefined>(
    initResult.kind === 'unpack-error' ? initResult : undefined,
  );
  const [us, setUs] = useState<UrlState>(initResult.kind === 'ok' ? initResult.us : defaultUs);

  useEffect(() => {
    window.onhashchange = () => {
      const result = parseHash(window.location.hash);
      if (result.kind === 'ok') {
        setUnpackError(undefined);
        setUs(result.us);
      } else if (result.kind === 'unpack-error') {
        setUnpackError(result);
      }
    };
  }, []);

  useEffect(() => setHash(us), [us]);

  if (initResult.kind === 'version-error') {
    return (
      <div style={{ color: 'red' }}>
        <h1>Unrecognised URL</h1>
        <p>
          The URL has state but no recognised version prefix. Try <a href="/">starting fresh</a>.
        </p>
      </div>
    );
  }

  if (unpackError) {
    return (
      <div style={{ color: 'red' }}>
        <h1>Corrupt URL state</h1>
        <p>{unpackError.message}</p>
        <p>
          Try <a href="/">starting fresh</a>.
        </p>
        <pre>{unpackError.hash}</pre>
      </div>
    );
  }

  return (
    <CrashHandler us={us}>
      <App uss={[us, setUs]} />
    </CrashHandler>
  );
}

// duplicated for stability reasons
const urlDictionary = strToU8(JSON.stringify(shallowSortKeys(defaultUs)));

function packUs(us: UrlState): string {
  const json = JSON.stringify(shallowSortKeys(us));
  const data = deflateSync(strToU8(json), {
    level: 9,
    dictionary: urlDictionary,
  });
  // @ts-expect-error (toBase64 is missing from Uint8Array typings)
  return HASH_VERSION + data.toBase64({ alphabet: 'base64url' });
}

function unpackUs(hash: string): UrlState {
  const encoded = hash.slice(1 + HASH_VERSION.length);
  // @ts-expect-error (fromBase64 is missing from Uint8Array typings)
  const data = Uint8Array.fromBase64(encoded, { alphabet: 'base64url' });
  const str = strFromU8(inflateSync(data, { dictionary: urlDictionary }));
  return { ...defaultUs, ...JSON.parse(str) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shallowSortKeys<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([ka], [kb]) => ka.localeCompare(kb))) as T;
}
