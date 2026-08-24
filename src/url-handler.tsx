import { useEffect, useState } from 'preact/hooks';
import { debounce } from './ts.ts';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { App } from './app.tsx';
import type { Cell } from './cell.ts';
import type { ModuleChoice } from './data.ts';
import { CrashHandler } from './crash-handler.tsx';
import { fingerprint, packCells, unpackCells, type PackedCell } from './pack.ts';

export interface UrlState {
  v: 1;
  /** the ResourceList search box */
  rs: string;
  /** the RecipeList search box */
  cs: string;
  /** game progress, as a whole percentage; searches favour results near it. See `relevanceOf`. */
  gp: number;
  /** the cells being planned; see `CELL.md` */
  cl: Cell[];
  /**
   * which of `cl` is being worked on: recipes added from the search go there, and the search's
   * `@in`/`@out` queries mean its edges. Out of range — which `[]` always is — means none is.
   */
  ci: number;
  /**
   * which module tier is meant by "a speed module", per module category; see `ModuleChoice`. A
   * category nobody has picked is absent, and follows `gp` instead. Nothing consumes this yet — the
   * cell rows will.
   */
  mo: ModuleChoice;
}

const defaultUs: UrlState = { v: 1, rs: '', cs: '', gp: 0, cl: [], ci: 0, mo: {} };

/** {@link UrlState} as it is written to the hash: see {@link PackedCell} for what changes. */
type PackedState = Omit<UrlState, 'cl'> & { cl: PackedCell[] };

/**
 * The letter every hash starts with, so that a hash written by an older build is refused rather
 * than misread. Bump the letter whenever the shape of `UrlState` changes — the dictionary is
 * derived from a state of the current shape, so a field added to one invalidates every hash anyway.
 *
 * The rest of it is `pack.ts`'s fingerprint, which does the same job for the dataset: cells are
 * packed as indices into `static.json`'s prototype lists, so regenerating it renumbers every saved
 * plan. That half moves on its own, because the ingest is a script which knows nothing about this
 * file and no-one would remember.
 */
const HASH_VERSION = `m${fingerprint}`;

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
          The URL has state but no recognised version prefix. Try{' '}
          <a href={window.location.pathname}>starting fresh</a>.
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
          Try <a href={window.location.pathname}>starting fresh</a>.
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

/**
 * What a full-ish plan looks like once packed, as the deflate dictionary: a hash is a few hundred
 * bytes, far too short for deflate to learn the key names from the payload itself, so it is handed
 * them.
 *
 * A literal, and in the packed shape rather than run through `packCells` — what earns its place
 * here is the punctuation around the numbers (`{"recipe":`, `,"machine":`, `"entries":[`), and
 * deriving it from real data would tie the dictionary to the dataset those recipes came from. The
 * numbers below are real indices all the same, so that their widths are representative.
 */
const referenceState: PackedState = {
  v: 1,
  rs: 'silicon',
  cs: 'makes:item:copper-plate',
  gp: 69,
  cl: [
    {
      entries: [
        {
          recipe: 320,
          count: 25,
        },
        {
          recipe: 1451,
          boostModules: 2,
        },
        {
          recipe: 1452,
          boostModules: 4,
          boost: 'speed',
        },
        {
          recipe: 45,
        },
        {
          recipe: 247,
        },
        {
          recipe: 1463,
          machine: 108,
        },
        {
          recipe: 1461,
        },
        {
          recipe: 249,
          modules: [
            [2, 1],
            [5, 3],
          ],
        },
        {
          recipe: 248,
        },
        {
          recipe: 1460,
          count: 4,
        },
        {
          recipe: 1114,
          machine: 65,
        },
        {
          recipe: 1115,
          machine: 67,
        },
        {
          recipe: 2207,
        },
      ],
    },
    {
      entries: [],
    },
  ],
  ci: 1,
  mo: {
    speed: 'speed-module-3',
    productivity: 'productivity-module',
    'angels-bio-yield': 'angels-bio-yield-module-5',
  },
};

const urlDictionary = strToU8(JSON.stringify(shallowSortKeys(referenceState)));

function packUs(us: UrlState): string {
  const packed: PackedState = { ...us, cl: packCells(us.cl) };
  const json = JSON.stringify(shallowSortKeys(packed));
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
  const packed = { ...defaultUs, ...JSON.parse(str) } as PackedState;
  return { ...packed, cl: unpackCells(packed.cl ?? []) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shallowSortKeys<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([ka], [kb]) => ka.localeCompare(kb))) as T;
}
