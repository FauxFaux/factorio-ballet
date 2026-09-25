import { useEffect, useMemo, useState } from 'preact/hooks';
import { App } from '../app.tsx';
import type { Cell } from '../cell.ts';
import type { BeaconChoice, BeltChoice } from '../data';
import type { ModuleChoice } from '../data/modules.ts';
import type { StaticData } from '../types.ts';
import { legacyDatasetId } from '../dataset/catalogue.ts';
import type { AssemblerDesignThroughput } from '../compute/assembler-design.ts';
import type { KernelMachineChoice } from '../compute/kernel-problems.ts';
import { CrashHandler } from './crash-handler.tsx';
import { createIdTables, packCells, unpackCells, type IdTables, type PackedCell } from './pack.ts';
import { packEnvelope, parseEnvelope, type PackedState } from './url-envelope.ts';
export { HASH_VERSION } from './url-envelope.ts';

export interface KernelCustomState {
  building: 'assembler' | 'air-filter' | KernelMachineChoice;
  flows: {
    solidInputs: number[];
    fluidInputs: number[];
    solidOutputs: number[];
    fluidOutputs: number[];
  };
  /** Absent follows overall game progress until a throughput slider is adjusted. */
  rates?: AssemblerDesignThroughput;
}

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
  /** Rail-blueprint input/output counts; a negative count displays that side as stacked. */
  rb?: [number, number];
  /** Show the standalone kernel-design workspace rather than a planner page. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- persisted as an empty object
  kd?: {};
  /** The editable kernel problem, retained when the workspace is hidden. */
  kp?: KernelCustomState;
}

const defaultUs: UrlState = { v: 1, cs: '', gp: 0, cl: [], ci: 0, mo: {} };

/** {@link UrlState} as it is written to the hash: see {@link PackedCell} for what changes. */
type PackedUrlState = Omit<UrlState, 'cl'> & { cl: PackedCell[]; dataset?: string };

type ParseResult =
  | { kind: 'ok'; us: UrlState }
  | { kind: 'version-error' }
  | { kind: 'unpack-error'; hash: string; message: string };

function parseHash(hash: string, idTables: IdTables): ParseResult {
  const envelope = parseEnvelope(hash);
  if (envelope.kind === 'empty') return { kind: 'ok', us: defaultUs };
  if (envelope.kind !== 'ok') return envelope;
  try {
    return { kind: 'ok', us: unpackUs(envelope.packed, idTables) };
  } catch (e) {
    return {
      kind: 'unpack-error',
      hash,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

export function UrlHandler({ data, datasetId }: { data: StaticData; datasetId: string }) {
  const idTables = useMemo(() => createIdTables(data), [data]);
  const [initResult] = useState(() => parseHash(window.location.hash, idTables));
  const [unpackError, setUnpackError] = useState<{ hash: string; message: string } | undefined>(
    initResult.kind === 'unpack-error' ? initResult : undefined,
  );
  const [us, setUs] = useState<UrlState>(initResult.kind === 'ok' ? initResult.us : defaultUs);

  useEffect(() => {
    const onHashChange = () => {
      const envelope = parseEnvelope(window.location.hash);
      if (envelope.kind === 'ok' && (envelope.packed.dataset ?? legacyDatasetId) !== datasetId) {
        return;
      }
      const result = parseHash(window.location.hash, idTables);
      if (result.kind === 'ok') {
        setUnpackError(undefined);
        setUs(result.us);
      } else if (result.kind === 'unpack-error') {
        setUnpackError(result);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [idTables, datasetId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      window.location.hash = packUs(us, idTables, datasetId);
    }, 50);
    return () => clearTimeout(timeout);
  }, [us, idTables, datasetId]);

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

function packUs(us: UrlState, idTables: IdTables, datasetId: string): string {
  const packed: PackedUrlState = { ...us, dataset: datasetId, cl: packCells(us.cl, idTables) };
  return packEnvelope(packed as PackedState);
}

function unpackUs(packedState: PackedState, idTables: IdTables): UrlState {
  // `rs` was the pre-merged resource search. Carry it into the unified search when an old link
  // has no recipe search, but do not keep writing the retired field back into new links.
  const {
    rs: legacyResourceSearch,
    dataset: _dataset,
    ...stored
  } = packedState as Partial<PackedUrlState> & {
    rs?: unknown;
  };
  const packed = {
    ...defaultUs,
    ...stored,
    cs: stored.cs || (typeof legacyResourceSearch === 'string' ? legacyResourceSearch : ''),
  } as PackedUrlState;
  return { ...packed, cl: unpackCells(packed.cl ?? [], idTables) };
}
