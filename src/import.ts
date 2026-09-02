import { decode } from '@msgpack/msgpack';
import type { Cell } from './cell.ts';

export interface DataSetConfiguration {
  /** Dataset id (`d.id`). */
  id: string;
  /** Dataset parser/style id (`d.style`). */
  style: string;
}

export interface Requirement {
  /** Item id (`i`). */
  i: string;
  /** Required quantity (`q`). */
  q: number;
}

export interface ImportExport {
  /** Item id (`i`). */
  i: string;
}

export interface ActiveProcess {
  /** Process id (`p`). */
  p: string;
  /** Factory id (`f`). */
  f: string;
  /** Process duration multiplier (`d`). */
  d: number;
  /** Process input multiplier (`i`). */
  i: number;
  /** Process output multiplier (`o`). */
  o: number;
}

export interface DehydratedGraphConfiguration {
  /** Current dataset configuration (`d`), or null when no dataset is selected. */
  d: DataSetConfiguration | null;
  /** Required items (`r`). */
  r: Requirement[];
  /** Imported/exported item ids (`io`). */
  io: ImportExport[];
  /** Active processes (`p`). */
  p: ActiveProcess[];
  /** Display/calculation units (`u`), normally "second" or "minute". */
  u: string;
}

/**
 * Convert the processes in a proc-rs graph into one cell.
 *
 * `p` and `f` have direct equivalents here: recipe and machine. The proc-rs modifiers do not:
 * `d` changes process duration, while `i` and `o` change ingredient and product quantities. A
 * CellEntry currently models machine count, loadout, and those two ids only, so those modifiers
 * are deliberately not imported. The graph's `d`, `r`, `io`, and `u` fields describe dataset,
 * requirements, imports/exports, and display units rather than active cell entries, and are also
 * outside this translation.
 */
export function cellFromConfiguration(configuration: DehydratedGraphConfiguration): Cell {
  return {
    entries: configuration.p.map(({ p, f }) => ({ recipe: p, machine: f })),
  };
}

/** Decode a persisted proc-rs URL or URL fragment. */
export function decodeUrl(url: string): DehydratedGraphConfiguration | null {
  const fragment = url.slice(url.indexOf('#') + 1);
  const encoded = new URLSearchParams(fragment).get('s0');
  if (encoded === null || encoded === '') return null;

  const bytes = decodeBase64Url(encoded);
  // rmp-serde serializes these structs as arrays. The elements correspond to the short field
  // names in DehydratedGraphConfiguration: d, r, io, p, u.
  const [dataset, requirements, importsExports, processes, units] = decode(bytes) as [
    [string, string] | null,
    [string, number][],
    [string][],
    // ActiveProcess fields, in order: p (process), f (factory), d (duration), i (input), o (output).
    [string, string, number, number, number][],
    string,
  ];

  return {
    d: dataset === null ? null : { id: dataset[0], style: dataset[1] },
    r: requirements.map(([i, q]) => ({ i, q })),
    io: importsExports.map(([i]) => ({ i })),
    p: processes.map(([p, f, d, i, o]) => ({ p, f, d, i, o })),
    u: units,
  };
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
