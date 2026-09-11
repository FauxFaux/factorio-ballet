import { useEffect, useState } from 'preact/hooks';
import { debounce } from './ts.ts';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { App } from './app.tsx';
import type { Cell } from './cell.ts';
import type { BeaconChoice, BeltChoice } from './data/index.ts';
import type { ModuleChoice } from './data/modules.ts';
import { CrashHandler } from './crash-handler.tsx';
import { fingerprint, packCells, unpackCells, type PackedCell } from './pack.ts';
import { COMMON_IDS, REFERENCE_STATE } from './data/common-ids.ts';

export interface UrlState {
  /**
   * Version of the JSON state schema. Prefer backward-compatible additions; bump this only when a
   * migration is necessary, and teach `unpackUs` to migrate older versions when practical.
   */
  v: 1;
  /** the combined resource and recipe search box */
  cs: string;
  /** game progress, as a whole percentage; searches favour results near it. See `relevanceOf`. */
  gp: number;
  /** the cells being planned; see `docs/guides/FACTORIO.md` */
  cl: Cell[];
  /**
   * which of `cl` is being worked on: recipes added from the search go there, and the search's
   * `@in`/`@out` queries mean its edges. Out of range — which `[]` always is — means none is.
   */
  ci: number;
  /**
   * which module tier is meant by "a speed module", per module category; see `ModuleChoice`. A
   * category nobody has picked is absent, and follows `gp` instead.
   */
  mo: ModuleChoice;
  /**
   * which beacon a row builds where its speed modules overflow the machine; see `BeaconChoice`.
   * Absent — which it is until someone picks one — follows `gp` through `defaultBeacon`, and
   * `null` is "none, whatever the progress".
   */
  be?: BeaconChoice;
  /**
   * which belt a future throughput check should use. Absent follows `gp` through `defaultBelt`.
   */
  bt?: BeltChoice;
  /**
   * Show the from-air planner rather than the usual cell planner. The infinite-mining mode also
   * admits synthetic recipes for resources whose infinite patches consume an unlocked fluid.
   */
  fa?: true | 'infinite-mining';
  /** The input and output station counts for the standalone rail-blueprint preview. */
  rb?: [number, number];
}

const defaultUs: UrlState = { v: 1, cs: '', gp: 0, cl: [], ci: 0, mo: {} };

/** {@link UrlState} as it is written to the hash: see {@link PackedCell} for what changes. */
type PackedState = Omit<UrlState, 'cl'> & { cl: PackedCell[] };

/**
 * The letter every hash starts with, so that a hash written by an older build is refused rather
 * than misread. This is deliberately independent of ordinary `UrlState` evolution: reserve a new
 * letter for a rebuilt compression dictionary, a significant static-data compatibility break, or
 * a major application version. Prefer optional, defaulted state fields for compatible changes. If
 * that is impossible, bump `UrlState.v` and make a reasonable attempt to migrate older schemas in
 * `unpackUs`.
 *
 * The rest of it is `pack.ts`'s fingerprint, which does the same job for the dataset: cells are
 * packed as indices into `static.json`'s prototype lists, so regenerating it renumbers every saved
 * plan. That half moves on its own, because the ingest is a script which knows nothing about this
 * file and no-one would remember.
 */
const HASH_VERSION = `y${fingerprint}`;

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

const urlDictionary = strToU8(COMMON_IDS + JSON.stringify(shallowSortKeys(REFERENCE_STATE)));

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
  // `rs` was the pre-merged resource search. Carry it into the unified search when an old link
  // has no recipe search, but do not keep writing the retired field back into new links.
  const { rs: legacyResourceSearch, ...stored } = JSON.parse(str) as Partial<PackedState> & {
    rs?: unknown;
  };
  const packed = {
    ...defaultUs,
    ...stored,
    cs: stored.cs || (typeof legacyResourceSearch === 'string' ? legacyResourceSearch : ''),
  } as PackedState;
  return { ...packed, cl: unpackCells(packed.cl ?? []) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shallowSortKeys<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([ka], [kb]) => ka.localeCompare(kb))) as T;
}
